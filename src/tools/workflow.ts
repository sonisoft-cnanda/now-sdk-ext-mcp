import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkflowManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the create_workflow tool on the MCP server.
 *
 * Creates a complete workflow from a single specification — workflow record,
 * version, activities, transitions, and optionally publishes it.
 */
export function registerCreateWorkflowTool(server: McpServer): void {
  server.registerTool(
    "create_workflow",
    {
      title: "Create Workflow",
      description:
        "Create a complete ServiceNow workflow from a single specification. " +
        "Orchestrates: create workflow record -> create version -> create activities -> " +
        "create transitions -> optionally publish.\n\n" +
        "Activities are referenced in transitions by their `id` field (if set) or " +
        "their array index (as a string like '0', '1', etc.).\n\n" +
        "IMPORTANT: This creates multiple records on the ServiceNow instance " +
        "(workflow, version, activities, transitions). Review the specification carefully.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        name: z.string().describe("Name of the workflow."),
        table: z
          .string()
          .describe(
            'Target table for the workflow (e.g., "incident", "change_request").'
          ),
        description: z
          .string()
          .optional()
          .describe("Description of the workflow."),
        activities: z
          .array(
            z.object({
              id: z
                .string()
                .optional()
                .describe(
                  "Optional identifier for referencing this activity in transitions."
                ),
              name: z.string().describe("Activity name."),
              activityType: z
                .string()
                .optional()
                .describe("Activity definition sys_id."),
              script: z
                .string()
                .optional()
                .describe("Script content for the activity."),
              vars: z
                .string()
                .optional()
                .describe("Activity variables."),
              x: z.number().optional().describe("X position in designer."),
              y: z.number().optional().describe("Y position in designer."),
              width: z.number().optional().describe("Width in designer."),
              height: z.number().optional().describe("Height in designer."),
            })
          )
          .describe("List of workflow activities to create."),
        transitions: z
          .array(
            z.object({
              from: z
                .string()
                .describe(
                  "Activity id or index (as string) for the source activity."
                ),
              to: z
                .string()
                .describe(
                  "Activity id or index (as string) for the target activity."
                ),
              conditionSysId: z
                .string()
                .optional()
                .describe("Condition sys_id for the transition."),
              order: z
                .number()
                .optional()
                .describe("Transition order."),
            })
          )
          .optional()
          .describe("Transitions between activities."),
        publish: z
          .boolean()
          .default(false)
          .describe(
            "Whether to publish the workflow after creation. " +
              "Requires start_activity to be specified."
          ),
        start_activity: z
          .string()
          .optional()
          .describe(
            "Activity id or index to use as the start activity. " +
              "Required when publish is true."
          ),
        condition: z
          .string()
          .optional()
          .describe("Workflow trigger condition."),
        access: z
          .string()
          .optional()
          .describe("Workflow access level."),
        template: z
          .boolean()
          .optional()
          .describe("Whether the workflow is a template."),
        active: z
          .boolean()
          .optional()
          .describe("Whether the workflow version is active."),
      },
    },
    async ({
      instance,
      name,
      table,
      description,
      activities,
      transitions,
      publish,
      start_activity,
      condition,
      access,
      template,
      active,
    }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new WorkflowManager(snInstance);
            return await mgr.createCompleteWorkflow({
              name,
              table,
              description,
              activities,
              transitions,
              publish,
              startActivity: start_activity,
              condition,
              access,
              template,
              active,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Workflow Created ===");
        lines.push(`Name: ${name}`);
        lines.push(`Table: ${table}`);
        lines.push(`Workflow sys_id: ${result.workflowSysId}`);
        lines.push(`Version sys_id: ${result.versionSysId}`);
        lines.push(`Published: ${result.published}`);

        if (result.startActivity) {
          lines.push(`Start Activity: ${result.startActivity}`);
        }

        lines.push("");
        lines.push("Activity sys_ids:");
        for (const [key, sysId] of Object.entries(result.activitySysIds)) {
          lines.push(`  ${key}: ${sysId}`);
        }

        if (result.transitionSysIds.length > 0) {
          lines.push("");
          lines.push("Transition sys_ids:");
          for (let i = 0; i < result.transitionSysIds.length; i++) {
            lines.push(`  ${i}: ${result.transitionSysIds[i]}`);
          }
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
              text: `Error creating workflow: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
