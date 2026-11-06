import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UpdateSetManager, WorkingSetManager } from "@sonisoft/now-sdk-ext-core";
import { setLine, workingSetErrorText } from "./working-set.js";
import { withConnectionRetry } from "../common/connection.js";
import { progressReporter } from "../common/progress.js";
import { annotationsFor } from "../common/annotations.js";

/**
 * Registers the get_current_update_set tool on the MCP server.
 *
 * This tool retrieves the currently active update set for the session.
 */
export function registerGetCurrentUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "get_current_update_set",
    {
      annotations: annotationsFor("get_current_update_set"),
      title: "Get Current Update Set",
      description:
        "Get the currently active update set for the session.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"myinstance", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my myinstance instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
      },
    },
    async ({ instance }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const manager = new UpdateSetManager(snInstance);
          return await manager.getCurrentUpdateSet();
        });

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No current update set is set for this session.",
              },
            ],
          };
        }

        const lines = [
          `Name: ${result.name}`,
          `sys_id: ${result.sys_id}`,
          `State: ${result.state}`,
          `Description: ${result.description || "(none)"}`,
          `Application: ${result.application || "(none)"}`,
        ];

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
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
              text: `Error getting current update set: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the list_update_sets tool on the MCP server.
 *
 * This tool lists update sets on the instance with optional filtering.
 */
export function registerListUpdateSetsTool(server: McpServer): void {
  server.registerTool(
    "list_update_sets",
    {
      annotations: annotationsFor("list_update_sets"),
      title: "List Update Sets",
      description:
        "List update sets on the instance with optional filtering.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"myinstance", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my myinstance instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        query: z
          .string()
          .optional()
          .describe(
            'Encoded query for filtering update sets (e.g., "state=in progress").'
          ),
        limit: z
          .number()
          .min(1)
          .max(500)
          .default(50)
          .describe(
            "Maximum number of update sets to return. Defaults to 50, max 500."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated list of fields to return (e.g., " +
            '"sys_id,name,state,description").'
          ),
      },
    },
    async ({ instance, query, limit, fields }) => {
      try {
        const results = await withConnectionRetry(instance, async (snInstance) => {
          const manager = new UpdateSetManager(snInstance);
          return await manager.listUpdateSets({ encodedQuery: query, limit, fields });
        });

        if (!results || results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No update sets found matching the criteria.",
              },
            ],
          };
        }

        const lines = results.map((us, index) => {
          const parts = [
            `${index + 1}. ${us.name}`,
            `   sys_id: ${us.sys_id}`,
            `   State: ${us.state}`,
            `   Description: ${us.description || "(none)"}`,
            `   Created: ${us.sys_created_on || "(unknown)"}`,
            `   Created by: ${us.sys_created_by || "(unknown)"}`,
          ];
          return parts.join("\n");
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} update set(s):\n\n${lines.join("\n\n")}`,
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
              text: `Error listing update sets: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the create_update_set tool on the MCP server.
 *
 * This tool creates a new update set on the ServiceNow instance.
 */
export function registerCreateUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "create_update_set",
    {
      annotations: annotationsFor("create_update_set"),
      title: "Create Update Set",
      description:
        "Create a new update set. IMPORTANT: This creates a new update set on the instance.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"myinstance", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my myinstance instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        name: z
          .string()
          .describe("The name of the update set to create."),
        description: z
          .string()
          .optional()
          .describe("Optional description for the update set."),
        application: z
          .string()
          .optional()
          .describe(
            "Optional application scope sys_id to associate with the update set."
          ),
      },
    },
    async ({ instance, name, description, application }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const manager = new UpdateSetManager(snInstance);
          return await manager.createUpdateSet({ name, description, application });
        });

        const lines = [
          `Update set created successfully.`,
          ``,
          `sys_id: ${result.sys_id}`,
          `Name: ${result.name}`,
          `State: ${result.state}`,
        ];

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
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
              text: `Error creating update set: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the set_current_update_set tool on the MCP server.
 *
 * This tool sets the active update set for the session. All subsequent
 * changes will be captured in the specified update set.
 */
export function registerSetCurrentUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "set_current_update_set",
    {
      annotations: annotationsFor("set_current_update_set"),
      title: "Set Current Update Set",
      description:
        "Make an In progress, non-Default update set the user's working set: the application (apps.current_app) and the " +
        "update set, saved for every later session, as nex update-set use does. The result is read back, and it reports the " +
        "previous working set: put it back with restore_update_set when the work is done. This changes what captures the " +
        "user's own later changes, in the UI and elsewhere.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"myinstance", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my myinstance instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        sys_id: z
          .string()
          .regex(/^[0-9a-f]{32}$/, "a 32-character sys_id")
          .describe("The sys_id of the In progress, non-Default update set to make current."),
        name: z
          .string()
          .optional()
          .describe("Deprecated and ignored: the set is identified by sys_id, and its name is read back."),
      },
    },
    async ({ instance, sys_id }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          (snInstance) => new WorkingSetManager(snInstance).useUpdateSet(sys_id),
          { retry: false }
        );
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Working set changed (read back): ${setLine(result.updateSet)}`,
                `Application: ${result.current.application}`,
                `Previous working set: application ${result.previous.application}, update set ${result.previous.updateSet}`,
                "Restore it with restore_update_set (application, update_set) when the work is done.",
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return workingSetErrorText("set_current_update_set", error);
      }
    }
  );
}

/**
 * Registers the inspect_update_set tool on the MCP server.
 *
 * This tool inspects an update set's contents, listing all components
 * grouped by type (business rules, script includes, etc.).
 */
export function registerInspectUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "inspect_update_set",
    {
      annotations: annotationsFor("inspect_update_set"),
      title: "Inspect Update Set",
      description:
        "Inspect an update set's contents — lists all components grouped by type " +
        "(business rules, script includes, etc.).",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"myinstance", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my myinstance instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        sys_id: z
          .string()
          .describe("The sys_id of the update set to inspect."),
      },
    },
    async ({ instance, sys_id }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const manager = new UpdateSetManager(snInstance);
          return await manager.inspectUpdateSet(sys_id);
        });

        const lines: string[] = [
          `Update Set: ${result.updateSet.name}`,
          `sys_id: ${result.updateSet.sys_id}`,
          `State: ${result.updateSet.state}`,
          `Description: ${result.updateSet.description || "(none)"}`,
          `Total Records: ${result.totalRecords}`,
        ];

        if (result.components.length === 0) {
          lines.push("", "No components found in this update set.");
        } else {
          lines.push("", "Components:");
          for (const component of result.components) {
            lines.push(``, `  ${component.type} (${component.count}):`);
            for (const item of component.items) {
              lines.push(`    - ${item}`);
            }
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
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
              text: `Error inspecting update set: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the clone_update_set tool on the MCP server.
 *
 * Clones an update set by creating a new update set and copying all records from the source.
 */
export function registerCloneUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "clone_update_set",
    {
      annotations: annotationsFor("clone_update_set"),
      title: "Clone Update Set",
      description:
        "Clone an existing update set by creating a new one and copying its records.\n\n" +
        "WARNING: do not use this to move or promote work. The copy keeps only a few columns of each capture " +
        "(name, type, target_name, payload, category): it drops application (the copies default to global), action, " +
        "table, replace_on_upgrade, update_guid and sys_recorded_at, so the clone does not commit like the original. " +
        "To move a capture use move_update_set_capture; to ship a set, complete it and export_update_set. " +
        "Use this only when the user asks for a clone knowing that.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"myinstance", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my myinstance instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        source_sys_id: z
          .string()
          .describe("The sys_id of the update set to clone."),
        new_name: z
          .string()
          .describe("The name for the new cloned update set."),
      },
    },
    async ({ instance, source_sys_id, new_name }, extra) => {
      try {
        const onProgress = progressReporter(extra);
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const manager = new UpdateSetManager(snInstance);
          return await manager.cloneUpdateSet(source_sys_id, new_name, onProgress);
        });

        const lines: string[] = [];
        lines.push("=== Update Set Cloned ===");
        lines.push(`Source: ${result.sourceUpdateSetName} (${result.sourceUpdateSetId})`);
        lines.push(`New: ${result.newUpdateSetName} (${result.newUpdateSetId})`);
        lines.push(`Records cloned: ${result.recordsCloned}/${result.totalSourceRecords}`);

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
              text: `Error cloning update set: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the move_update_set_records tool on the MCP server.
 *
 * Moves records from one update set to another.
 */
export function registerMoveUpdateSetRecordsTool(server: McpServer): void {
  server.registerTool(
    "move_update_set_records",
    {
      annotations: annotationsFor("move_update_set_records"),
      title: "Move Update Set Records",
      description:
        "Move records from one update set to another, by sys_id or all records of a source set.\n\n" +
        "WARNING: this is unverified: any HTTP 200 counts as moved, nothing is read back, and it does not check the " +
        "same-application rule, newer captures elsewhere, or duplicates in the target. Prefer move_update_set_capture, " +
        "which checks all of those and reads the move back; if you use this, query sys_update_xml afterwards.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"myinstance", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my myinstance instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        target_update_set_id: z
          .string()
          .describe("The sys_id of the update set to move records TO."),
        record_sys_ids: z
          .array(z.string())
          .optional()
          .describe(
            "Specific sys_ids of sys_update_xml records to move. " +
            "If omitted and source_update_set is provided, moves all records from the source."
          ),
        source_update_set: z
          .string()
          .optional()
          .describe(
            "The sys_id of the source update set to move all records FROM. " +
            "Used when record_sys_ids is not specified."
          ),
      },
    },
    async ({ instance, target_update_set_id, record_sys_ids, source_update_set }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const manager = new UpdateSetManager(snInstance);
          return await manager.moveRecordsToUpdateSet(target_update_set_id, {
            recordSysIds: record_sys_ids,
            sourceUpdateSet: source_update_set,
          });
        });

        const lines: string[] = [];
        lines.push("=== Move Update Set Records ===");
        lines.push(`Target Update Set: ${target_update_set_id}`);
        lines.push(`Moved: ${result.moved}`);
        lines.push(`Failed: ${result.failed}`);

        if (result.errors && result.errors.length > 0) {
          lines.push("");
          lines.push("Errors:");
          for (const err of result.errors) {
            lines.push(`  ${JSON.stringify(err)}`);
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
              text: `Error moving update set records: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
