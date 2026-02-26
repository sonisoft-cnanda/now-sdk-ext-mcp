import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UpdateSetManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the get_current_update_set tool on the MCP server.
 *
 * This tool retrieves the currently active update set for the session.
 */
export function registerGetCurrentUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "get_current_update_set",
    {
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
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
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
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
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
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
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
      title: "Set Current Update Set",
      description:
        "Set the active update set for the session. All changes will be captured in this update set.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        name: z
          .string()
          .describe("The name of the update set to set as current."),
        sys_id: z
          .string()
          .describe("The sys_id of the update set to set as current."),
      },
    },
    async ({ instance, name, sys_id }) => {
      try {
        await withConnectionRetry(instance, async (snInstance) => {
          const manager = new UpdateSetManager(snInstance);
          return await manager.setCurrentUpdateSet({ name, sysId: sys_id });
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Current update set changed to "${name}" (${sys_id}). All subsequent changes will be captured in this update set.`,
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
              text: `Error setting current update set: ${message}`,
            },
          ],
          isError: true,
        };
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
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
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
