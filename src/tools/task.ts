import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskOperations } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Instance parameter description shared across all task tools.
 */
const INSTANCE_DESC =
  "The ServiceNow instance auth alias to use. " +
  'This is the alias configured via `snc configure` (e.g., "dev224436", "prod", "test"). ' +
  'The user will typically refer to this by name when saying things like "on my dev224436 instance". ' +
  "If not provided, falls back to the SN_AUTH_ALIAS environment variable.";

// ============================================================
// 1. add_task_comment
// ============================================================

/**
 * Registers the add_task_comment tool on the MCP server.
 *
 * Adds a comment or work note to any task-based record
 * (incident, change_request, problem, etc.).
 */
export function registerAddTaskCommentTool(server: McpServer): void {
  server.registerTool(
    "add_task_comment",
    {
      title: "Add Task Comment",
      description:
        "Add a comment or work note to any task-based record (incident, change_request, " +
        "problem, etc.). Comments are customer-visible by default; set is_work_note to true " +
        "for internal work notes visible only to fulfiller staff.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        table: z
          .string()
          .describe(
            'The table name of the task record (e.g., "incident", "change_request", "problem", "sc_task").'
          ),
        record_sys_id: z
          .string()
          .describe("The sys_id of the task record to add the comment to."),
        comment: z
          .string()
          .describe("The comment text to add to the record."),
        is_work_note: z
          .boolean()
          .default(false)
          .describe(
            "If true, adds a work note (internal, visible to fulfillers only) " +
            "instead of a customer-visible comment. Defaults to false."
          ),
      },
    },
    async ({ instance, table, record_sys_id, comment, is_work_note }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const ops = new TaskOperations(snInstance);
          return await ops.addComment({
            table,
            recordSysId: record_sys_id,
            comment,
            isWorkNote: is_work_note,
          });
        });

        const noteType = is_work_note ? "Work note" : "Comment";
        const number = result.number ? ` (${result.number})` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `${noteType} added successfully to ${table}/${result.sys_id}${number}.`,
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
              text: `Error adding comment: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 2. assign_task
// ============================================================

/**
 * Registers the assign_task tool on the MCP server.
 *
 * Assigns a task record to a user and optionally an assignment group.
 */
export function registerAssignTaskTool(server: McpServer): void {
  server.registerTool(
    "assign_task",
    {
      title: "Assign Task",
      description:
        "Assign a task record to a user and optionally an assignment group. " +
        "Works on any task-based table (incident, change_request, problem, sc_task, etc.).",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        table: z
          .string()
          .describe(
            'The table name of the task record (e.g., "incident", "change_request", "sc_task").'
          ),
        record_sys_id: z
          .string()
          .describe("The sys_id of the task record to assign."),
        assigned_to: z
          .string()
          .describe(
            "The sys_id or user_name of the user to assign the task to."
          ),
        assignment_group: z
          .string()
          .optional()
          .describe(
            "The sys_id of the assignment group. Optional — if provided, the record's " +
            "assignment_group field is also updated."
          ),
      },
    },
    async ({ instance, table, record_sys_id, assigned_to, assignment_group }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const ops = new TaskOperations(snInstance);
          return await ops.assignTask({
            table,
            recordSysId: record_sys_id,
            assignedTo: assigned_to,
            assignmentGroup: assignment_group,
          });
        });

        const number = result.number ? ` (${result.number})` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${table}/${result.sys_id}${number} assigned successfully to ${assigned_to}.`,
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
              text: `Error assigning task: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 3. resolve_incident
// ============================================================

/**
 * Registers the resolve_incident tool on the MCP server.
 *
 * Resolves an incident by setting state to Resolved (6) with resolution notes.
 */
export function registerResolveIncidentTool(server: McpServer): void {
  server.registerTool(
    "resolve_incident",
    {
      title: "Resolve Incident",
      description:
        "Resolve an incident by setting state to Resolved (6) with resolution notes. " +
        "IMPORTANT: This changes the incident state. The incident must typically be in " +
        "an active state (New, In Progress, On Hold) for this to succeed.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z
          .string()
          .describe("The sys_id of the incident to resolve."),
        resolution_notes: z
          .string()
          .describe(
            "Notes describing how the incident was resolved. These become the close_notes on the record."
          ),
        close_code: z
          .string()
          .optional()
          .describe(
            'The close code for the resolution (e.g., "Solved (Permanently)", ' +
            '"Solved (Work Around)", "Not Solved (Not Reproducible)").'
          ),
      },
    },
    async ({ instance, sys_id, resolution_notes, close_code }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const ops = new TaskOperations(snInstance);
          return await ops.resolveIncident({
            sysId: sys_id,
            resolutionNotes: resolution_notes,
            closeCode: close_code,
          });
        });

        const number = result.number ? ` ${result.number}` : "";
        const state = result.state ?? "6";
        return {
          content: [
            {
              type: "text" as const,
              text: `Incident${number} (${result.sys_id}) resolved successfully. State: ${state}.`,
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
              text: `Error resolving incident: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 4. close_incident
// ============================================================

/**
 * Registers the close_incident tool on the MCP server.
 *
 * Closes an incident by setting state to Closed (7).
 */
export function registerCloseIncidentTool(server: McpServer): void {
  server.registerTool(
    "close_incident",
    {
      title: "Close Incident",
      description:
        "Close an incident by setting state to Closed (7). " +
        "IMPORTANT: This changes the incident state. The incident should typically be " +
        "in Resolved state before closing, though this depends on instance configuration.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z
          .string()
          .describe("The sys_id of the incident to close."),
        close_notes: z
          .string()
          .describe("Notes describing why the incident is being closed."),
        close_code: z
          .string()
          .optional()
          .describe(
            'The close code for the closure (e.g., "Solved (Permanently)", ' +
            '"Solved (Work Around)", "Closed/Resolved by Caller").'
          ),
      },
    },
    async ({ instance, sys_id, close_notes, close_code }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const ops = new TaskOperations(snInstance);
          return await ops.closeIncident({
            sysId: sys_id,
            closeNotes: close_notes,
            closeCode: close_code,
          });
        });

        const number = result.number ? ` ${result.number}` : "";
        const state = result.state ?? "7";
        return {
          content: [
            {
              type: "text" as const,
              text: `Incident${number} (${result.sys_id}) closed successfully. State: ${state}.`,
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
              text: `Error closing incident: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 5. approve_change
// ============================================================

/**
 * Registers the approve_change tool on the MCP server.
 *
 * Approves a change request with optional comments.
 */
export function registerApproveChangeTool(server: McpServer): void {
  server.registerTool(
    "approve_change",
    {
      title: "Approve Change Request",
      description:
        "Approve a change request with optional comments. Sets the approval field to " +
        "'approved'. IMPORTANT: This changes the change request's approval status.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z
          .string()
          .describe("The sys_id of the change request to approve."),
        comments: z
          .string()
          .optional()
          .describe("Optional comments to include with the approval."),
      },
    },
    async ({ instance, sys_id, comments }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const ops = new TaskOperations(snInstance);
          return await ops.approveChange({
            sysId: sys_id,
            comments,
          });
        });

        const number = result.number ? ` ${result.number}` : "";
        const approval = (result as Record<string, unknown>).approval ?? "approved";
        return {
          content: [
            {
              type: "text" as const,
              text: `Change request${number} (${result.sys_id}) approved successfully. Approval: ${approval}.`,
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
              text: `Error approving change request: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 6. find_task
// ============================================================

/**
 * Registers the find_task tool on the MCP server.
 *
 * Finds a task record by its number (e.g., "INC0010001", "CHG0030002").
 */
export function registerFindTaskTool(server: McpServer): void {
  server.registerTool(
    "find_task",
    {
      title: "Find Task by Number",
      description:
        "Find a task record by its number (e.g., \"INC0010001\", \"CHG0030002\"). " +
        "Returns the full record if found, or a clear message if not. " +
        "Use this to look up sys_ids, check current state, or retrieve task details " +
        "before performing actions like assigning or resolving.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        table: z
          .string()
          .describe(
            'The table name to search in (e.g., "incident", "change_request", "problem", "sc_task").'
          ),
        number: z
          .string()
          .describe(
            'The task number to find (e.g., "INC0010001", "CHG0030002", "PRB0040001").'
          ),
      },
    },
    async ({ instance, table, number }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const ops = new TaskOperations(snInstance);
          return await ops.findByNumber(table, number);
        });

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No record found in ${table} with number "${number}".`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
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
              text: `Error finding task: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
