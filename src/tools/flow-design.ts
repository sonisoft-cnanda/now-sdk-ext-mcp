import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FlowManager,
  isPolicyRefusal,
  type ActionDefinitionResult,
  type FlowArtifactDefinitionResult,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";
import { clean, cleanMessage, dataBlock, text } from "../common/tool-text.js";
import { instanceParam } from "./working-set.js";

/**
 * Flow Designer tools nex has and this server lacked: a flow's design-time definition (`nex flow definition`), and a
 * message to a paused execution (`nex flow message`).
 */

const SYS_ID = /^[0-9a-f]{32}$/;
const SCOPE = /^[a-z0-9_]{1,80}$/;
// Core puts the message and payload into a single-quoted script literal: a line break there is a syntax error.
const SCRIPT_SAFE = /^[^\p{Cc}\u2028\u2029]*$/u;

function failure(lines: string[]) {
  return { ...text(lines), isError: true };
}

export function registerGetFlowDefinitionTool(server: McpServer): void {
  server.registerTool(
    "get_flow_definition",
    {
      annotations: annotationsFor("get_flow_definition"),
      title: "Get Flow Definition",
      description:
        "Read the design-time definition of a Flow Designer flow, subflow or action as Workflow Studio stores it: its " +
        "trigger, steps, flow logic, inputs and outputs. What the artifact IS, not what a run of it did (for that, use " +
        "get_flow_execution_details). Nothing is run, published or changed. The type is never inferred: a sys_id of another " +
        "type fails with type_mismatch.",
      inputSchema: {
        instance: instanceParam,
        sys_id: z.string().regex(SYS_ID).describe("The flow's or subflow's sys_hub_flow sys_id, or the action's sys_hub_action_type_definition sys_id."),
        type: z.enum(["flow", "subflow", "action"]).optional().describe("What the sys_id is. Default flow."),
        scope: z.string().regex(SCOPE).optional().describe("The application scope to read it in, when it is not global."),
        view: z
          .enum(["summary", "full"])
          .optional()
          .describe("summary (default): name, scope, state and counts, plus an action's steps. full: the complete definition as compact JSON."),
      },
    },
    async ({ instance, sys_id, type, scope, view }) => {
      const kind = type ?? "flow";
      try {
        const options = scope ? { scope } : undefined;
        const result = await withConnectionRetry<ActionDefinitionResult | FlowArtifactDefinitionResult>(instance, (sn) => {
          const fm = new FlowManager(sn);
          return kind === "action" ? fm.getActionDefinition(sys_id, options)
            : kind === "subflow" ? fm.getSubflowDefinition(sys_id, options)
            : fm.getFlowDesignDefinition(sys_id, options);
        });
        if (!result.success) {
          return failure([
            `Error (get_flow_definition): no ${kind} definition for ${sys_id}` +
              `${result.failureReason ? ` (${clean(result.failureReason)})` : ""}: ${cleanMessage(result.errorMessage ?? "")}`,
          ]);
        }
        if (view === "full") {
          // Compact: a subflow's full definition is ~90k characters pretty-printed.
          return text([dataBlock(JSON.stringify(result), "Flow definition", "view summary")]);
        }
        return text([dataBlock(JSON.stringify({ sysId: result.sysId, type: result.artifactType, summary: result.summary }, null, 2), "Flow definition", "view summary")]);
      } catch (error) {
        return failure([
          isPolicyRefusal(error)
            ? `Error (get_flow_definition): refused by policy: ${cleanMessage((error as Error).message)}`
            : `Error (get_flow_definition): ${cleanMessage(error instanceof Error ? error.message : String(error))}`,
        ]);
      }
    }
  );
}

export function registerSendFlowMessageTool(server: McpServer): void {
  server.registerTool(
    "send_flow_message",
    {
      annotations: annotationsFor("send_flow_message"),
      title: "Send Flow Message",
      description:
        "Send a message to a paused flow execution (one waiting in a Wait For Message step), which resumes it: the flow then " +
        "runs whatever comes next. Sent from a server-side script (sn_fd.FlowAPI.sendMessage). Only when the user asked; the " +
        "message must be the one the step waits for. The platform accepts a message even when nothing is waiting for it, so " +
        "check get_flow_context_status afterwards to see whether the flow resumed.",
      inputSchema: {
        instance: instanceParam,
        context_id: z.string().regex(SYS_ID).describe("The execution's sys_flow_context sys_id."),
        message: z.string().trim().min(1).max(200).regex(SCRIPT_SAFE, "no control characters or line breaks").describe("The message the Wait For Message step waits for."),
        payload: z
          .string()
          .max(10_000)
          .regex(SCRIPT_SAFE, "no control characters or line breaks: send JSON on one line")
          .optional()
          .describe("Payload passed with the message, on one line (e.g. minified JSON)."),
        scope: z.string().regex(SCOPE).optional().describe("The scope to run the sending script in, when it is not global."),
      },
    },
    async ({ instance, context_id, message, payload, scope }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          (sn) => new FlowManager(sn, scope).sendFlowMessage(context_id, message, payload),
          { retry: false }
        );
        if (result.success) {
          // FlowAPI.sendMessage also succeeds for a context that is not waiting (seen live on a COMPLETE one).
          return text([
            `Message '${clean(message)}' sent to flow context ${context_id}. The platform does not say whether a step was ` +
              "waiting for it: check get_flow_context_status to see whether the flow resumed.",
          ]);
        }
        const reason = cleanMessage(result.errorMessage ?? "");
        // The script reports the platform's refusal itself; anything else means it may not have finished.
        return failure(
          result.rawScriptResult === null || /^Could not parse/.test(result.errorMessage ?? "")
            ? [
                `Error (send_flow_message): ${reason}`,
                "It may have been delivered before this failed: check get_flow_context_status before sending it again.",
              ]
            : [`Error (send_flow_message): the platform did not accept the message for ${context_id}: ${reason}`]
        );
      } catch (error) {
        return failure(
          isPolicyRefusal(error)
            ? [`Error (send_flow_message): refused by policy: ${cleanMessage((error as Error).message)}`]
            : [
                `Error (send_flow_message): ${cleanMessage(error instanceof Error ? error.message : String(error))}`,
                "It may have been delivered before this failed: check get_flow_context_status before sending it again.",
              ]
        );
      }
    }
  );
}
