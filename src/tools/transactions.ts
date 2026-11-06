import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ClusterTransactionManager, isPolicyRefusal } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";
import { clean, cleanMessage, dataBlock, text } from "../common/tool-text.js";
import { instanceParam } from "./working-set.js";

/**
 * Active transactions across the cluster, as `nex transaction list|kill` do: the platform's Active Transactions
 * (All Nodes) page, and its Kill action.
 */

const SYS_ID = /^[0-9a-f]{32}$/;

function failure(lines: string[]) {
  return { ...text(lines), isError: true };
}

/**
 * A transaction's URL without its query values or fragment: other users' requests can carry tokens, OAuth codes or
 * secrets there (access_token=, client_secret=, code=), which core's message redaction does not all catch. The keys
 * stay, so the request is still recognisable.
 */
export function urlWithoutValues(url: string): string {
  return url.replace(/#.*$/s, "").replace(/([?&;][^=&#;]*)=[^&#;]*/g, "$1=…");
}

/** Messages core throws before the kill request is sent. */
const NOT_SENT = /Kill action is unavailable|session token is required|Could not uniquely resolve the Kill UI action|must be a 32-character/;

const errorLine = (action: string, error: unknown): string =>
  isPolicyRefusal(error)
    ? `Error (${action}): refused by policy: ${cleanMessage((error as Error).message)}`
    : `Error (${action}): ${cleanMessage(error instanceof Error ? error.message : String(error))}`;

export function registerListTransactionsTool(server: McpServer): void {
  server.registerTool(
    "list_transactions",
    {
      annotations: annotationsFor("list_transactions"),
      title: "List Active Transactions",
      description:
        "List the transactions running now on every responding cluster node (Active Transactions, All Nodes): user, age, " +
        "type, state and URL (query values removed). For finding a stuck or runaway request. The nodes are asked to report " +
        "and polled, so this can take some seconds.",
      inputSchema: {
        instance: instanceParam,
        query: z
          .string()
          .max(1000)
          .regex(/^[^\p{Cc}]*$/u, "no control characters")
          .refine((q) => !/javascript:/i.test(q), "no javascript:")
          .optional()
          .describe("Encoded query on the transaction list, e.g. ageGREATERTHAN60000 or user=admin."),
        limit: z.number().int().min(1).max(1000).optional().describe("Maximum transactions to return. Default 200."),
        timeout_seconds: z
          .number()
          .int()
          .min(5)
          .max(300)
          .optional()
          .describe("How long to wait for the nodes to report. Default 30, under the 60-second request timeout many MCP clients use."),
      },
    },
    async ({ instance, query, limit, timeout_seconds }, extra) => {
      try {
        const rows = await withConnectionRetry(instance, (sn) =>
          new ClusterTransactionManager(sn).getTransactions({
            ...(query ? { query } : {}),
            limit: limit ?? 200,
            timeoutMs: (timeout_seconds ?? 30) * 1000,
            // Polling stops when the client cancels the request.
            signal: extra.signal,
          })
        );
        if (rows.length === 0) return text(["0 active transactions"]);
        const lines = rows.map(
          (t) =>
            `- ${clean(t.sys_id)} on ${clean(t.node_id)}: ${clean(t.user)}, age ${clean(t.age)}, ${clean(t.type)}, ${clean(t.state)}, ` +
            `${clean(t.foreground) === "true" ? "foreground" : "background"}, ${clean(t.query_count)} queries: ` +
            cleanMessage(urlWithoutValues(t.url ?? "")).slice(0, 200)
        );
        return text([`${rows.length} active transaction(s)`, dataBlock(lines.join("\n"), "Transactions", "a narrower query or a lower limit")]);
      } catch (error) {
        return failure([errorLine("list_transactions", error)]);
      }
    }
  );
}

export function registerKillTransactionTool(server: McpServer): void {
  server.registerTool(
    "kill_transaction",
    {
      annotations: annotationsFor("kill_transaction"),
      title: "Kill Transaction",
      description:
        "Ask the platform to cancel one active transaction (the Kill action on Active Transactions). The work it was doing " +
        "stops part way and is not undone, and the user who started it gets an error. Only when the user asked, for a " +
        "transaction found with list_transactions; never one of your own requests.",
      inputSchema: {
        instance: instanceParam,
        transaction_id: z.string().regex(SYS_ID).describe("The transaction's sys_id, from list_transactions."),
        confirm: z.string().regex(SYS_ID).describe("The same sys_id again, to confirm."),
      },
    },
    async ({ instance, transaction_id, confirm }) => {
      if (confirm !== transaction_id) {
        return failure(["Error (kill_transaction): confirm must repeat transaction_id exactly. Nothing was sent."]);
      }
      try {
        const result = await withConnectionRetry(
          instance,
          (sn) => new ClusterTransactionManager(sn).killTransaction(transaction_id),
          { retry: false }
        );
        // Core throws rather than returning accepted: false; kept in case that changes.
        return result.accepted
          ? text([`The platform accepted the request to kill ${clean(result.sysId)}. Check with list_transactions that it has gone.`])
          : failure([`Error (kill_transaction): the platform did not accept the request to kill ${clean(result.sysId)}.`]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure([
          errorLine("kill_transaction", error),
          ...(isPolicyRefusal(error)
            ? []
            : NOT_SENT.test(message)
              ? ["Nothing was sent. The transaction may have ended: list again, and retry with a current sys_id."]
              : /did not accept/.test(message)
                ? ["The request was sent and refused: check with list_transactions whether it is still running."]
                : ["The request may have been sent before this failed: check with list_transactions."]),
        ]);
      }
    }
  );
}
