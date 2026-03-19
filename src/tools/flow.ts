import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FlowManager,
  type FlowTestResult,
  type FlowCopyResult,
  type FlowContextDetailsResult,
  type FlowLogResult,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Instance parameter description shared across flow tools.
 */
const INSTANCE_DESC =
  "The ServiceNow instance auth alias to use. " +
  'This is the alias configured via `now-sdk auth --add` (e.g., "myinstance", "prod", "test"). ' +
  'The user will typically refer to this by name when saying things like "on my myinstance instance". ' +
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
        "Execute a published ServiceNow Flow Designer flow by scoped name. " +
        "Runs the flow using sn_fd.FlowAPI via a background script.\n\n" +
        "In foreground mode (default), the call blocks until the flow completes and " +
        "returns outputs directly. In background mode, it returns immediately with a " +
        "context ID that you can poll with get_flow_context_status.\n\n" +
        "IMPORTANT: Flows with approval or wait steps MUST use background mode — " +
        "foreground mode will fail if the flow enters a waiting state.\n\n" +
        "NOTE: This tool requires the flow to be published. If you are iterating and " +
        "building a flow that may not be published yet, use test_flow instead — it " +
        "tests the flow in its current draft state, exactly as the 'Test' button in " +
        "Flow Designer does.",
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
// Helper: format FlowTestResult for test_flow output
// ============================================================

function formatTestResult(result: FlowTestResult, runOnThread: boolean): string {
  const lines: string[] = [];
  lines.push("=== Flow Test Result ===");
  lines.push(`Success: ${result.success}`);

  if (result.contextId) {
    lines.push(`Context ID: ${result.contextId}`);
    lines.push("");
    if (runOnThread) {
      // Synchronous execution — the flow has already completed on the server.
      // The context ID can still be used to inspect outputs or errors.
      lines.push(
        "The flow ran synchronously. Use get_flow_outputs to retrieve outputs " +
          "or get_flow_error if the flow encountered an error."
      );
    } else {
      // Asynchronous execution — poll until complete.
      lines.push(
        "The test has been submitted. Use get_flow_context_status to poll " +
          "the execution status, then get_flow_outputs or get_flow_error once complete."
      );
    }
  }
  if (result.errorMessage) {
    lines.push("");
    lines.push(`Error: ${result.errorMessage}`);
  }
  if (result.errorCode !== undefined && result.errorCode !== 0) {
    lines.push(`Error Code: ${result.errorCode}`);
  }

  return lines.join("\n");
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

// ============================================================
// 8. test_flow
// ============================================================

/**
 * Registers the test_flow MCP tool.
 *
 * Tests a Flow Designer flow without requiring it to be published first.
 * Uses FlowManager.testFlow(), which posts to the ProcessFlow REST API
 * (POST /api/now/processflow/flow/{id}/test). This is the preferred tool
 * when iteratively building and testing flows in Flow Designer.
 *
 * The method fetches the full flow definition, merges in the provided
 * outputMap (trigger test values), and submits it to the test endpoint —
 * identical to what the 'Test' button in Flow Designer does.
 *
 * @param server - The McpServer instance to register the tool on
 */
export function registerTestFlowTool(server: McpServer): void {
  server.registerTool(
    "test_flow",
    {
      title: "Test Flow (Flow Designer)",
      description:
        "Test a ServiceNow Flow Designer flow without requiring it to be published. " +
        "This is the PRIMARY tool to use when building and iterating on a flow — it " +
        "invokes the same API as the 'Test' button in Flow Designer, running the flow " +
        "in its current saved (draft) state.\n\n" +
        "Unlike execute_flow (which requires a published flow and uses sn_fd.FlowAPI), " +
        "test_flow works on unpublished drafts via the ProcessFlow REST API " +
        "(POST /api/now/processflow/flow/{id}/test).\n\n" +
        "Provide the flow's sys_id or scoped name in flow_id, and supply trigger output " +
        "variable values in output_map. For record-triggered flows this is typically " +
        '{ "current": "<record_sys_id>", "table_name": "<table>" }. Check the flow\'s ' +
        "trigger configuration in Flow Designer to determine the correct variable names.\n\n" +
        "The tool returns a context ID on success — use get_flow_context_status to poll " +
        "the execution, then get_flow_outputs or get_flow_error once complete.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        flow_id: z
          .string()
          .describe(
            "Flow sys_id (32-char hex) or scoped name (e.g., \"x_myapp.my_flow\"). " +
              "The flow does not need to be published."
          ),
        output_map: z
          .record(z.string())
          .describe(
            "Maps trigger output variable names to concrete test values. " +
              "Keys are the variable names defined in the flow's trigger configuration in Flow Designer. " +
              'For record-triggered flows: { "current": "<record_sys_id>", "table_name": "<table>" }. ' +
              "Open the flow in Flow Designer and inspect the trigger to see the available variable names."
          ),
        scope: z
          .string()
          .optional()
          .describe(
            "Scope sys_id for the transaction scope query parameter. " +
              "If omitted, the scope is auto-resolved from the flow definition."
          ),
        run_on_thread: z
          .boolean()
          .optional()
          .describe(
            "Whether to run the test synchronously on the current thread. Default: true."
          ),
      },
    },
    async ({ instance, flow_id, output_map, scope, run_on_thread }) => {
      const runOnThread = run_on_thread ?? true;
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            // Do not pass scope to the FlowManager constructor — that scope only
            // applies to BackgroundScriptExecutor, which testFlow does not use.
            // The scope for the ProcessFlow REST API is passed via testFlow options.
            const mgr = new FlowManager(snInstance);
            return await mgr.testFlow({
              flowId: flow_id,
              outputMap: output_map,
              scope,
              runOnThread,
            });
          }
        );

        return {
          content: [{ type: "text" as const, text: formatTestResult(result, runOnThread) }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error testing flow: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Helper: format FlowCopyResult for copy_flow output
// ============================================================

function formatCopyResult(result: FlowCopyResult): string {
  const lines: string[] = [];
  lines.push("=== Flow Copy Result ===");
  lines.push(`Success: ${result.success}`);

  if (result.newFlowSysId) {
    lines.push(`New Flow sys_id: ${result.newFlowSysId}`);
    lines.push("");
    lines.push(
      "The flow has been copied into your application scope in draft/unpublished state."
    );
    lines.push("");
    lines.push("Recommended next steps:");
    lines.push(
      `1. Pull the flow using: now-sdk transform --flow ${result.newFlowSysId}`
    );
    lines.push("2. Modify the pulled source in your project");
    lines.push("3. Push your changes back to the instance");
    lines.push("4. Test with test_flow");
    lines.push("5. Publish with publish_flow when ready");
  } else if (result.success) {
    lines.push("");
    lines.push(
      "No new flow sys_id returned — copy may not have completed successfully."
    );
  }
  if (result.errorMessage) {
    lines.push("");
    lines.push(`Error: ${result.errorMessage}`);
  }
  if (result.errorCode !== undefined && result.errorCode !== 0) {
    lines.push(`Error Code: ${result.errorCode}`);
  }

  return lines.join("\n");
}

// ============================================================
// 9. copy_flow
// ============================================================

/**
 * Registers the copy_flow MCP tool.
 *
 * Copies an existing Flow Designer flow into a target scoped application
 * using FlowManager.copyFlow(), which posts to the ProcessFlow REST API
 * (POST /api/now/processflow/flow/{id}/copy).
 *
 * This is the best-practice first step in the ServiceNow workflow
 * for modifying any flow — OOB and shared flows must never be modified
 * directly. The copy lands in draft/unpublished state in the target scope
 * and can then be pulled locally, modified, pushed, tested, and published.
 *
 * Full lifecycle:
 *   copy_flow → now-sdk transform → modify → push → test_flow → publish_flow
 *
 * @param server - The McpServer instance to register the tool on
 */
export function registerCopyFlowTool(server: McpServer): void {
  server.registerTool(
    "copy_flow",
    {
      title: "Copy Flow (Flow Designer)",
      description:
        "Copy an existing ServiceNow Flow Designer flow into a target scoped application. " +
        "This is the best-practice first step when you want to modify any flow — " +
        "OOB (out-of-box) and shared flows should not be modified directly. Copying " +
        "into your application scope first keeps the original intact and gives you a " +
        "flow you own and can freely modify.\n\n" +
        "This tool enables the full AI-assisted flow development lifecycle:\n" +
        "  copy_flow → pull with 'now-sdk transform' → modify → push → test_flow → publish_flow\n\n" +
        "The copied flow lands in draft/unpublished state in the target scope with a new " +
        "sys_id, independent of the source. The tool returns the new flow's sys_id and " +
        "prints the exact 'now-sdk transform' command to pull it locally.\n\n" +
        "Use list_scoped_apps to find the target_scope sys_id for your application.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        source_flow_id: z
          .string()
          .describe(
            "Source flow sys_id (32-char hex) or scoped name (e.g., \"global.change__standard\"). " +
              "This is the flow you want to copy. It can be an OOB flow, a flow in global scope, " +
              "or a flow in any other application scope."
          ),
        name: z
          .string()
          .describe(
            "Display name for the newly created flow copy " +
              "(e.g., \"Copy of Change - Standard\"). " +
              "This becomes the flow's name in Flow Designer."
          ),
        target_scope: z
          .string()
          .describe(
            "Scope sys_id of the target application to copy the flow into. " +
              "This must be a sys_id (not a scope name). " +
              "Use list_scoped_apps to find the sys_id for your application scope."
          ),
      },
    },
    async ({ instance, source_flow_id, name, target_scope }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            // Do not pass scope to the FlowManager constructor — that scope only
            // applies to BackgroundScriptExecutor, which copyFlow does not use
            // (it uses the ProcessFlow REST API directly).
            const mgr = new FlowManager(snInstance);
            return await mgr.copyFlow({
              sourceFlowId: source_flow_id,
              name,
              targetScope: target_scope,
            });
          }
        );

        return {
          content: [{ type: "text" as const, text: formatCopyResult(result) }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error copying flow: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Helper: format FlowContextDetailsResult for get_flow_execution_details
// ============================================================

function formatFlowExecutionDetails(result: FlowContextDetailsResult): string {
  const lines: string[] = [];
  lines.push("=== Flow Execution Details ===");
  lines.push(`Context ID: ${result.contextId}`);

  const ctx = result.flowContext;
  if (ctx) {
    lines.push(`Flow: ${ctx.name}`);
    lines.push(`State: ${ctx.state}`);
    lines.push(`Runtime: ${ctx.runTime}ms`);
    lines.push(`Test Run: ${ctx.isTestRun}`);
    lines.push(`Executed As: ${ctx.executedAs}`);
    lines.push(`Initiated By: ${ctx.flowInitiatedBy}`);
    if (ctx.executionSource?.callingSource) {
      lines.push(`Triggered By: ${ctx.executionSource.callingSource}`);
    }
    if (ctx.executionSource?.executionSourceTable) {
      lines.push(`Source Table: ${ctx.executionSource.executionSourceTable}`);
    }
    if (ctx.executionSource?.executionSourceRecordDisplay) {
      lines.push(
        `Source Record: ${ctx.executionSource.executionSourceRecordDisplay}`
      );
    }
  }

  const report = result.flowReport;
  if (report) {
    const actionReports = Object.values(report.actionOperationsReports ?? {});
    const subflowReports = Object.values(
      report.subflowOperationsReports ?? {}
    );
    const allReports = [...actionReports, ...subflowReports].sort(
      (a, b) => parseInt(a.operationsCore.order, 10) - parseInt(b.operationsCore.order, 10)
    );

    if (allReports.length > 0) {
      lines.push("");
      lines.push("--- Action Results ---");
      allReports.forEach((action, idx) => {
        const label =
          action.stepLabel ??
          action.actionTypeName ??
          `Action ${action.actionName}`;
        const state = action.operationsCore.state;
        const runTime = action.operationsCore.runTime;
        lines.push(`${idx + 1}. ${label}  [${state}, ${runTime}ms]`);

        if (action.operationsCore.error) {
          lines.push(`   Error: ${action.operationsCore.error}`);
        }

        const inputs = action.operationsInput?.data;
        if (inputs && Object.keys(inputs).length > 0) {
          const simplified: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(inputs)) {
            simplified[k] = v.displayValue ?? v.value;
          }
          lines.push(`   Inputs: ${JSON.stringify(simplified)}`);
        }

        const outputs = action.operationsOutput?.data;
        if (outputs && Object.keys(outputs).length > 0) {
          const simplified: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(outputs)) {
            simplified[k] = v.displayValue ?? v.value;
          }
          lines.push(`   Outputs: ${JSON.stringify(simplified)}`);
        }
      });
    }

    // Top-level flow outputs
    const flowOutputs = report.operationsOutput?.data;
    if (flowOutputs && Object.keys(flowOutputs).length > 0) {
      lines.push("");
      lines.push("--- Flow Outputs ---");
      for (const [k, v] of Object.entries(flowOutputs)) {
        lines.push(`  ${k}: ${v.displayValue ?? v.value}`);
      }
    }
  }

  // Report availability notice (shown when flowReport is missing)
  const avail = result.flowReportAvailabilityDetails;
  if (avail?.errorMessage && !report) {
    lines.push("");
    lines.push(`Note: ${avail.errorMessage}`);
  }

  if (result.errorMessage) {
    lines.push("");
    lines.push(`Error: ${result.errorMessage}`);
  }

  return lines.join("\n");
}

// ============================================================
// Helper: format FlowLogResult for get_flow_logs
// ============================================================

function mapLogLevel(level: string): string {
  switch (level) {
    case "-1":
      return "ERROR";
    case "1":
      return "WARN ";
    case "2":
      return "INFO ";
    case "3":
      return "DEBUG";
    default:
      return `L${level}  `;
  }
}

function formatFlowLogs(result: FlowLogResult): string {
  const lines: string[] = [];
  lines.push("=== Flow Execution Logs ===");
  lines.push(`Context ID: ${result.contextId}`);
  lines.push(`Entries: ${result.entries.length}`);

  if (result.entries.length === 0) {
    lines.push("");
    lines.push(
      "No log entries found. Logs may be empty for simple successful executions, " +
        "or flow logging may be disabled (reporting level NONE)."
    );
  } else {
    lines.push("");
    result.entries.forEach((entry, idx) => {
      const level = mapLogLevel(entry.level);
      const action = entry.action || "(flow)";
      const ts = entry.createdOn ? ` [${entry.createdOn}]` : "";
      lines.push(
        `[${idx + 1}] ${level} | ${action.slice(0, 30).padEnd(30)} | ${entry.message}${ts}`
      );
    });
  }

  if (result.errorMessage) {
    lines.push("");
    lines.push(`Error: ${result.errorMessage}`);
  }

  return lines.join("\n");
}

// ============================================================
// 10. get_flow_execution_details
// ============================================================

/**
 * Registers the get_flow_execution_details MCP tool.
 *
 * Returns rich execution data for a flow context: per-action timing, inputs,
 * outputs, execution metadata (who ran it, test vs production, runtime, etc.).
 * Uses FlowManager.getFlowContextDetails() which calls the ProcessFlow operations API
 * (GET /api/now/processflow/operations/flow/context/{id}).
 *
 * This is the primary tool to use after test_flow to understand what happened
 * in an execution, diagnose failures, and iterate on the flow definition.
 *
 * @param server - The McpServer instance to register the tool on
 */
export function registerGetFlowExecutionDetailsTool(server: McpServer): void {
  server.registerTool(
    "get_flow_execution_details",
    {
      title: "Get Flow Execution Details",
      description:
        "Get rich execution details for a flow context: per-action timing, inputs, " +
        "outputs, and high-level metadata (state, runtime, who ran it, test vs production).\n\n" +
        "This is the primary diagnostic tool after test_flow or execute_flow — use it to " +
        "understand what each action did, identify which step failed, inspect inputs and " +
        "outputs, and iterate on the flow definition.\n\n" +
        "Uses the ProcessFlow operations API (GET /api/now/processflow/operations/flow/context/{id}), " +
        "the same endpoint Flow Designer uses to display execution details.\n\n" +
        "IMPORTANT: Requires flow operations logging to be enabled on the instance. If " +
        "the execution report is unavailable, the response will include a notice explaining why.\n\n" +
        "Typical workflow:\n" +
        "  test_flow → get_flow_execution_details → diagnose → modify flow → test_flow again",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        context_id: z
          .string()
          .describe(
            "The flow context sys_id returned by test_flow, execute_flow, " +
              "execute_subflow, or execute_action (the contextId field in the result)."
          ),
        scope: z
          .string()
          .optional()
          .describe(
            "Scope sys_id for the ProcessFlow API transaction scope query parameter. " +
              "If omitted, the API uses the default scope."
          ),
        include_flow_definition: z
          .boolean()
          .optional()
          .describe(
            "Whether to include the full flow definition snapshot in the response. " +
              "Default: false. Enable only when you need to inspect the raw flow structure."
          ),
      },
    },
    async ({ instance, context_id, scope, include_flow_definition }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            // Do not pass scope to the FlowManager constructor — that scope only
            // applies to BackgroundScriptExecutor. getFlowContextDetails uses
            // the ProcessFlow REST API and receives scope via its own parameter.
            const mgr = new FlowManager(snInstance);
            return await mgr.getFlowContextDetails(
              context_id,
              scope,
              include_flow_definition
            );
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatFlowExecutionDetails(result),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting flow execution details: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 11. get_flow_logs
// ============================================================

/**
 * Registers the get_flow_logs MCP tool.
 *
 * Retrieves flow execution log entries from sys_flow_log for a given context.
 * Uses FlowManager.getFlowLogs() to query the log table.
 *
 * Log entries include error messages, step-level logs, and cancellation reasons.
 * They may be empty for simple successful executions or when logging is disabled.
 *
 * @param server - The McpServer instance to register the tool on
 */
export function registerGetFlowLogsTool(server: McpServer): void {
  server.registerTool(
    "get_flow_logs",
    {
      title: "Get Flow Execution Logs",
      description:
        "Retrieve flow execution log entries from sys_flow_log for a given context.\n\n" +
        "Log entries include error messages, step-level debug output, and cancellation " +
        "reasons. Use this alongside get_flow_execution_details to get the full picture " +
        "of what happened during an execution.\n\n" +
        "Note: Log entries may be empty for simple successful executions, or if the flow's " +
        "reporting level is set to NONE. Errors and warnings are always logged regardless " +
        "of the reporting level setting.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        context_id: z
          .string()
          .describe(
            "The flow context sys_id returned by test_flow, execute_flow, " +
              "execute_subflow, or execute_action."
          ),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of log entries to return. Default: 100."),
        order_direction: z
          .enum(["asc", "desc"])
          .optional()
          .describe(
            'Order direction: "asc" (default, oldest first) or "desc" (newest first).'
          ),
      },
    },
    async ({ instance, context_id, limit, order_direction }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            // Do not pass scope to the FlowManager constructor — getFlowLogs
            // queries sys_flow_log via the table API, not BackgroundScriptExecutor.
            const mgr = new FlowManager(snInstance);
            return await mgr.getFlowLogs(context_id, {
              limit,
              orderDirection: order_direction,
            });
          }
        );

        return {
          content: [
            { type: "text" as const, text: formatFlowLogs(result) },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting flow logs: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
