import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DENY_ENV, checkRequirement, currentLayers, type Verb } from "@sonisoft/now-sdk-ext-core";
import { annotationsFor } from "../common/annotations.js";

/**
 * `get_policy_status` — what this server permits, and which layer decided, as `nex policy status` reports it.
 *
 * Registered regardless of the active package, like list_tool_packages: a model that was refused needs to tell
 * "the environment denies changes" from "this tool is not in the package" without guessing. It reads only this
 * process's policy and touches no instance.
 */
export function registerGetPolicyStatusTool(server: McpServer): void {
  server.registerTool(
    "get_policy_status",
    {
      annotations: annotationsFor("get_policy_status"),
      title: "Get Policy Status",
      description:
        "Show what this server permits right now: whether changing instance data (write) and running scripts, flows or " +
        "tests (execute) are allowed, and which policy layer decided. Reads are never gated. Use it when a tool was " +
        "refused. The policy is set in the server's environment and cannot be changed from a tool call.",
      inputSchema: {},
    },
    () => {
      const verbs: Verb[] = ["write", "execute"];
      const lines = ["Instance changes:"];
      for (const verb of verbs) {
        const decision = checkRequirement({ target: "instance", verbs: [verb] });
        lines.push(`- ${verb}: ${decision.allowed ? "permitted" : "REFUSED"} (decided by ${decision.decidingLayer})`);
      }
      lines.push(
        "Reads are never gated.",
        // From the installed policy, as read once at startup (core ignores a blank value), not the variable now.
        currentLayers().some((layer) => layer.name.startsWith(DENY_ENV))
          ? `${DENY_ENV} was set when the server started.`
          : `${DENY_ENV} was not set when the server started: changes are restricted only by the instance's own ACLs.`,
        "",
        "Layers, highest priority first:",
        ...currentLayers().map((layer) => `- ${layer.name}`)
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
