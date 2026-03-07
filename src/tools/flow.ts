import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FlowManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Instance parameter description shared across flow tools.
 */
const INSTANCE_DESC =
  "The ServiceNow instance auth alias to use. " +
  'This is the alias configured via `now-sdk auth --add` (e.g., "dev224436", "prod", "test"). ' +
  'The user will typically refer to this by name when saying things like "on my dev224436 instance". ' +
  "If not provided, falls back to the SN_AUTH_ALIAS environment variable.";

/**
 * Shared Zod schema fragments for execution parameters common to all
 * execute_flow / execute_subflow / execute_action tools.
 */
const executionInputSchema = {
  instance: z.string().optional().describe(INSTANCE_DESC),
  scoped_name: z
    .string()
    .describe(
      'Scoped name of the flow/subflow/action to execute (e.g., "global.my_flow", ' +
        '"x_myapp_custom.create_incident_subflow").'
    ),
  inputs: z
    .record(z.unknown())
    .optional()
    .describe(
      "Input name-value pairs to pass to the flow/subflow/action. " +
        "Keys are the input variable names defined in Flow Designer."
    ),
  mode: z
    .enum(["foreground", "background"])
    .optional()
    .describe(
      'Execution mode. "foreground" (default) runs synchronously and returns outputs ' +
        "when complete. " +
        '"background" returns immediately with a context ID — use get_flow_context_status ' +
        "to poll, then get_flow_outputs or get_flow_error to retrieve results. " +
        "Use background for flows with approval/wait steps."
    ),
  timeout: z
    .number()
    .optional()
    .describe(
      "Timeout in milliseconds for the execution. " +
        "Only applies to foreground mode. Default is the ServiceNow server default (~30s)."
    ),
  quick: z
    .boolean()
    .optional()
    .describe(
      "Skip creation of execution detail records for better performance. " +
        "Default false. Use true in CI/CD or when you don't need step-level detail."
    ),
  scope: z
    .string()
    .optional()
    .describe(
      "Scope context for script execution. Can be a scope name " +
        '(e.g., "x_myapp_custom") or sys_id. Use when the flow is in a scoped app.'
    ),
};

/**
 * Format a FlowExecutionResult into human-readable text output.
 */
function formatExecutionResult(result: {
  success: boolean;
  flowObjectName: string;
  flowObjectType: string;
  contextId?: string;
  executionDate?: string;
  outputs?: Record<string, unknown>;
  debugOutput?: string;
  errorMessage?: string;
}): string {
  const lines: string[] = [];
  lines.push(`=== Flow Execution Result ===`);
  lines.push(`Success: ${result.success}`);
  lines.push(`Type: ${result.flowObjectType}`);
  lines.push(`Name: ${result.flowObjectName}`);

  if (result.contextId) {
    lines.push(`Context ID: ${result.contextId}`);
  }
  if (result.executionDate) {
    lines.push(`Execution Date: ${result.executionDate}`);
  }
  if (result.errorMessage) {
    lines.push(`Error: ${result.errorMessage}`);
  }
  if (result.outputs && Object.keys(result.outputs).length > 0) {
    lines.push("");
    lines.push("Outputs:");
    lines.push(JSON.stringify(result.outputs, null, 2));
  }
  if (result.debugOutput) {
    lines.push("");
    lines.push("Debug Output:");
    lines.push(result.debugOutput);
  }

  return lines.join("\n");
}

// ============================================================
// 1. execute_flow
// ============================================================

export function registerExecuteFlowTool(server: McpServer): void {
  server.registerTool(
    "execute_flow",
    {
      title: "Execute Flow",
      description:
        "Execute a ServiceNow Flow Designer flow by scoped name. " +
        "Runs the flow using sn_fd.FlowAPI via a background script.\n\n" +
        "In foreground mode (default), the call blocks until the flow completes and " +
        "returns outputs directly. In background mode, it returns immediately with a " +
        "context ID that you can poll with get_flow_context_status.\n\n" +
        "IMPORTANT: Flows with approval or wait steps MUST use background mode — " +
        "foreground mode will fail if the flow enters a waiting state.",
      inputSchema: executionInputSchema,
    },
    async ({ instance, scoped_name, inputs, mode, timeout, quick, scope }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new FlowManager(snInstance, scope);
            return await mgr.executeFlow({
              scopedName: scoped_name,
              inputs,
              mode,
              timeout,
              quick,
              scope,
            });
          }
        );

        return {
          content: [
            { type: "text" as const, text: formatExecutionResult(result) },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: "text" as const, text: `Error executing flow: ${message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 2. execute_subflow
// ============================================================

export function registerExecuteSubflowTool(server: McpServer): void {
  server.registerTool(
    "execute_subflow",
    {
      title: "Execute Subflow",
      description:
        "Execute a ServiceNow Flow Designer subflow by scoped name. " +
        "Subflows are reusable building blocks in Flow Designer — this is the " +
        "primary tool for testing subflows during development.\n\n" +
        "In foreground mode (default), the call blocks until the subflow completes " +
        "and returns outputs directly. In background mode, it returns a context ID " +
        "for polling with get_flow_context_status.\n\n" +
        "Pass inputs as key-value pairs matching the subflow's input variables.",
      inputSchema: executionInputSchema,
    },
    async ({ instance, scoped_name, inputs, mode, timeout, quick, scope }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new FlowManager(snInstance, scope);
            return await mgr.executeSubflow({
              scopedName: scoped_name,
              inputs,
              mode,
              timeout,
              quick,
              scope,
            });
          }
        );

        return {
          content: [
            { type: "text" as const, text: formatExecutionResult(result) },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing subflow: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 3. execute_action
// ============================================================

export function registerExecuteActionTool(server: McpServer): void {
  server.registerTool(
    "execute_action",
    {
      title: "Execute Action",
      description:
        "Execute a ServiceNow Flow Designer action by scoped name. " +
        "Actions are the lowest-level building blocks in Flow Designer " +
        "(e.g., lookup record, create task, send notification).\n\n" +
        "In foreground mode (default), the call blocks until the action completes " +
        "and returns outputs directly. Actions typically complete quickly and " +
        "foreground mode is usually appropriate.",
      inputSchema: executionInputSchema,
    },
    async ({ instance, scoped_name, inputs, mode, timeout, quick, scope }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new FlowManager(snInstance, scope);
            return await mgr.executeAction({
              scopedName: scoped_name,
              inputs,
              mode,
              timeout,
              quick,
              scope,
            });
          }
        );

        return {
          content: [
            { type: "text" as const, text: formatExecutionResult(result) },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing action: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 4. get_flow_context_status
// ============================================================

export function registerGetFlowContextStatusTool(server: McpServer): void {
  server.registerTool(
    "get_flow_context_status",
    {
      title: "Get Flow Context Status",
      description:
        "Query the current status of a flow execution by its context ID. " +
        "Use this to poll background flow executions started with execute_flow, " +
        "execute_subflow, or execute_action in background mode.\n\n" +
        "Possible states: QUEUED, IN_PROGRESS, WAITING, COMPLETE, CANCELLED, ERROR.\n\n" +
        "Typical pattern: execute in background -> poll this tool every few seconds -> " +
        "once COMPLETE, call get_flow_outputs. If ERROR, call get_flow_error.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        context_id: z
          .string()
          .describe(
            "The flow context sys_id returned from an execute_flow, " +
              "execute_subflow, or execute_action call (the contextId field)."
          ),
      },
    },
    async ({ instance, context_id }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new FlowManager(snInstance);
            return await mgr.getFlowContextStatus(context_id);
          }
        );

        const lines: string[] = [];
        lines.push("=== Flow Context Status ===");
        lines.push(`Context ID: ${result.contextId}`);
        lines.push(`Found: ${result.found}`);

        if (result.found) {
          lines.push(`State: ${result.state}`);
          if (result.name) lines.push(`Name: ${result.name}`);
          if (result.started) lines.push(`Started: ${result.started}`);
          if (result.ended) lines.push(`Ended: ${result.ended}`);
        }
        if (result.errorMessage) {
          lines.push(`Error: ${result.errorMessage}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting flow context status: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 5. get_flow_outputs
// ============================================================

export function registerGetFlowOutputsTool(server: McpServer): void {
  server.registerTool(
    "get_flow_outputs",
    {
      title: "Get Flow Outputs",
      description:
        "Retrieve outputs from a completed flow/subflow/action execution by its " +
        "context ID. Only call this after get_flow_context_status shows COMPLETE.\n\n" +
        "Returns the output name-value pairs defined by the flow/subflow/action.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        context_id: z
          .string()
          .describe(
            "The flow context sys_id from the execution result's contextId field."
          ),
      },
    },
    async ({ instance, context_id }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new FlowManager(snInstance);
            return await mgr.getFlowOutputs(context_id);
          }
        );

        const lines: string[] = [];
        lines.push("=== Flow Outputs ===");
        lines.push(`Context ID: ${result.contextId}`);
        lines.push(`Success: ${result.success}`);

        if (result.outputs && Object.keys(result.outputs).length > 0) {
          lines.push("");
          lines.push("Outputs:");
          lines.push(JSON.stringify(result.outputs, null, 2));
        } else {
          lines.push("\nNo outputs returned.");
        }
        if (result.errorMessage) {
          lines.push(`\nError: ${result.errorMessage}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting flow outputs: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 6. get_flow_error
// ============================================================

export function registerGetFlowErrorTool(server: McpServer): void {
  server.registerTool(
    "get_flow_error",
    {
      title: "Get Flow Error",
      description:
        "Retrieve the error message from a failed flow execution by its context ID. " +
        "Call this after get_flow_context_status shows ERROR to understand why the " +
        "flow failed.\n\n" +
        "Returns the flow's error message which can be used to diagnose and fix " +
        "issues in the flow definition.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        context_id: z
          .string()
          .describe(
            "The flow context sys_id from the execution result's contextId field."
          ),
      },
    },
    async ({ instance, context_id }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new FlowManager(snInstance);
            return await mgr.getFlowError(context_id);
          }
        );

        const lines: string[] = [];
        lines.push("=== Flow Error ===");
        lines.push(`Context ID: ${result.contextId}`);
        lines.push(`Success: ${result.success}`);

        if (result.flowErrorMessage) {
          lines.push(`\nFlow Error Message:\n${result.flowErrorMessage}`);
        } else {
          lines.push("\nNo error message found for this context.");
        }
        if (result.errorMessage) {
          lines.push(`\nExecution Error: ${result.errorMessage}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting flow error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 7. cancel_flow
// ============================================================

export function registerCancelFlowTool(server: McpServer): void {
  server.registerTool(
    "cancel_flow",
    {
      title: "Cancel Flow",
      description:
        "Cancel a running or paused flow execution by its context ID. " +
        "Use this to stop a background flow that is no longer needed, " +
        "is stuck in a waiting state, or was started by mistake.\n\n" +
        "IMPORTANT: This is a destructive operation — the flow will be " +
        "permanently cancelled and cannot be resumed.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        context_id: z
          .string()
          .describe(
            "The flow context sys_id from the execution result's contextId field."
          ),
        reason: z
          .string()
          .optional()
          .describe(
            'Reason for cancellation. Default: "Cancelled via FlowManager".'
          ),
      },
    },
    async ({ instance, context_id, reason }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new FlowManager(snInstance);
            return await mgr.cancelFlow(context_id, reason);
          }
        );

        const lines: string[] = [];
        lines.push("=== Flow Cancellation ===");
        lines.push(`Context ID: ${result.contextId}`);
        lines.push(`Success: ${result.success}`);
        if (result.errorMessage) {
          lines.push(`Error: ${result.errorMessage}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error cancelling flow: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
