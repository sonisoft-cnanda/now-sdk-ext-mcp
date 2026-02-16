import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CodeSearch } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the code_search tool on the MCP server.
 *
 * Searches for code across a ServiceNow instance using the Code Search API.
 * This is the primary tool for finding scripts, business rules, and other
 * code artifacts on the platform.
 */
export function registerCodeSearchTool(server: McpServer): void {
  server.registerTool(
    "code_search",
    {
      title: "Code Search",
      description:
        "Search for code across a ServiceNow instance using the Code Search API. " +
        "Finds matching scripts, business rules, script includes, and other code artifacts " +
        "across the platform. Results include the record name, table, field, and matching " +
        "line numbers with context.\n\n" +
        "Code Search works through Search Groups, which define sets of tables and fields " +
        "to search. There is typically a default search group. Use `list_code_search_groups` " +
        "to discover available groups, and `list_code_search_tables` to see which tables " +
        "a group covers.\n\n" +
        "Key use cases:\n" +
        "- Find scripts that reference a specific API, table, or pattern\n" +
        "- Locate business rules, script includes, or UI scripts containing specific logic\n" +
        "- Verify whether code has been deployed to an instance\n" +
        "- Search within a specific application scope or table",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        term: z
          .string()
          .describe(
            "The search term to find in code. Searches across script fields " +
              "in the tables defined by the search group."
          ),
        search_group: z
          .string()
          .optional()
          .describe(
            "The search group NAME to scope the search (e.g., " +
              '"Default Code Search Group"). If omitted, the instance\'s ' +
              "default search group is used. Use `list_code_search_groups` " +
              "to discover available groups."
          ),
        table: z
          .string()
          .optional()
          .describe(
            "Specific table to search within (e.g., \"sys_script_include\"). " +
              "Requires `search_group` to also be specified. Use " +
              "`list_code_search_tables` to see available tables for a group."
          ),
        current_app: z
          .string()
          .optional()
          .describe(
            "Application scope to limit results to (e.g., \"x_myapp\"). " +
              "When set, only results from this application scope are returned. " +
              "Automatically sets search_all_scopes to false."
          ),
        search_all_scopes: z
          .boolean()
          .optional()
          .describe(
            "When false, limits results to files within the scope specified by " +
              "`current_app`. Defaults to true (search all scopes)."
          ),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results to return."),
      },
    },
    async ({
      instance,
      term,
      search_group,
      table,
      current_app,
      search_all_scopes,
      limit,
    }) => {
      try {
        const results = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const codeSearch = new CodeSearch(snInstance);

            // If current_app is specified but search_all_scopes is not,
            // default to false (matching searchInApp behavior)
            const effectiveSearchAllScopes =
              current_app && search_all_scopes === undefined
                ? false
                : search_all_scopes;

            return await codeSearch.search({
              term,
              search_group,
              table,
              current_app,
              search_all_scopes: effectiveSearchAllScopes,
              limit,
            });
          }
        );

        // Build output
        const lines: string[] = [];

        lines.push("=== Code Search Results ===");
        const searchInfo: string[] = [`Search: "${term}"`];
        if (search_group) searchInfo.push(`Group: ${search_group}`);
        if (table) searchInfo.push(`Table: ${table}`);
        if (current_app) searchInfo.push(`App: ${current_app}`);
        if (limit) searchInfo.push(`Limit: ${limit}`);
        lines.push(searchInfo.join(" | "));
        lines.push("");

        // Use the core library's formatter for result details
        lines.push(CodeSearch.formatResultsAsText(results));

        // Footer tips
        if (!search_group) {
          lines.push("");
          lines.push(
            "Tip: Use `list_code_search_groups` to discover available search groups, " +
              "then pass the group name as `search_group` to scope your search."
          );
        }

        if (results.length === 0) {
          lines.push("");
          lines.push(
            "No matching code found. Try a different search term, or use " +
              "`list_code_search_tables` to verify which tables are being searched."
          );
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
              text: `Error searching code: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the list_code_search_groups tool on the MCP server.
 *
 * Lists available code search groups on a ServiceNow instance.
 * Search groups define which tables and fields are included in code searches.
 */
export function registerListCodeSearchGroupsTool(server: McpServer): void {
  server.registerTool(
    "list_code_search_groups",
    {
      title: "List Code Search Groups",
      description:
        "List available code search groups on a ServiceNow instance. " +
        "Search groups define which tables and fields are included when performing " +
        "a code search. Each instance typically has a default search group, and " +
        "additional groups can be created for specific use cases.\n\n" +
        "Use the group `name` as the `search_group` parameter in `code_search`. " +
        "Use the group `sys_id` when adding tables via `add_code_search_table`.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        limit: z
          .number()
          .default(100)
          .describe(
            "Maximum number of search groups to return. Default is 100."
          ),
      },
    },
    async ({ instance, limit }) => {
      try {
        const groups = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const codeSearch = new CodeSearch(snInstance);
            return await codeSearch.getSearchGroups({ limit });
          }
        );

        const lines: string[] = [];

        lines.push("=== Code Search Groups ===");
        lines.push(`Found: ${groups.length} group(s)`);

        if (groups.length === 0) {
          lines.push("");
          lines.push("No code search groups found on this instance.");
        } else {
          groups.forEach((group, index) => {
            lines.push("");
            lines.push(`${index + 1}. ${group.name}`);
            lines.push(`   sys_id: ${group.sys_id}`);
            if (group.description) {
              const truncated =
                group.description.length > 120
                  ? group.description.substring(0, 120) + "..."
                  : group.description;
              lines.push(`   Description: ${truncated}`);
            }
          });
        }

        lines.push("");
        lines.push(`=== ${groups.length} group(s) found ===`);
        lines.push("");
        lines.push(
          "Tip: Use the group name as `search_group` in `code_search`. " +
            "Use the sys_id as `search_group` in `add_code_search_table`."
        );

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
              text: `Error listing code search groups: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the list_code_search_tables tool on the MCP server.
 *
 * Lists the tables associated with a code search group — these are the
 * tables that get searched when using that group in a code search.
 */
export function registerListCodeSearchTablesTool(server: McpServer): void {
  server.registerTool(
    "list_code_search_tables",
    {
      title: "List Code Search Tables",
      description:
        "List the tables associated with a code search group. These are the tables " +
        "and fields that are searched when performing a code search with that group.\n\n" +
        "Use this to understand what a search group covers, or to identify if a " +
        "specific table is missing and needs to be added via `add_code_search_table`.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        search_group: z
          .string()
          .describe(
            "The search group NAME (not sys_id) to list tables for. " +
              "Use `list_code_search_groups` to find available group names."
          ),
      },
    },
    async ({ instance, search_group }) => {
      try {
        const tables = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const codeSearch = new CodeSearch(snInstance);
            return await codeSearch.getTablesForSearchGroup(search_group);
          }
        );

        const lines: string[] = [];

        lines.push(`=== Tables in Search Group: ${search_group} ===`);
        lines.push(`Found: ${tables.length} table(s)`);

        if (tables.length === 0) {
          lines.push("");
          lines.push(
            "No tables found in this search group. Use `add_code_search_table` to add tables."
          );
        } else {
          tables.forEach((table, index) => {
            lines.push("");
            lines.push(
              `${index + 1}. ${table.name}${table.label ? ` (${table.label})` : ""}`
            );
          });
        }

        lines.push("");
        lines.push(`=== ${tables.length} table(s) found ===`);

        if (tables.length > 0) {
          lines.push("");
          lines.push(
            "Tip: Use `add_code_search_table` to add a table to this search group, " +
              "or pass a table name as `table` in `code_search` to search a specific table."
          );
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
              text: `Error listing code search tables: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the add_code_search_table tool on the MCP server.
 *
 * Adds a new table to an existing code search group, expanding what
 * gets searched when using that group.
 */
export function registerAddCodeSearchTableTool(server: McpServer): void {
  server.registerTool(
    "add_code_search_table",
    {
      title: "Add Code Search Table",
      description:
        "Add a new table to an existing code search group, expanding what gets searched. " +
        "After adding a table, code searches using that group will also search the " +
        "specified fields on the new table.\n\n" +
        "Requires the search group's sys_id (get it from `list_code_search_groups`) " +
        "and the table name and fields to search.\n\n" +
        "IMPORTANT: This modifies the code search configuration on the instance. " +
        "Verify the table name and fields before adding.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        table: z
          .string()
          .describe(
            "The table name to add to the search group (e.g., " +
              '"sys_script_include", "sys_ui_script"). Use `lookup_table` ' +
              "to verify the table name exists."
          ),
        search_fields: z
          .string()
          .describe(
            "Comma-separated field names to search on this table (e.g., " +
              '"script,name", "script"). Use `lookup_columns` to find ' +
              "available fields on the table."
          ),
        search_group: z
          .string()
          .describe(
            "The sys_id of the target code search group. Get this from " +
              "`list_code_search_groups`."
          ),
      },
    },
    async ({ instance, table, search_fields, search_group }) => {
      try {
        const record = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const codeSearch = new CodeSearch(snInstance);
            return await codeSearch.addTableToSearchGroup({
              table,
              search_fields,
              search_group,
            });
          }
        );

        const lines: string[] = [];

        lines.push("=== Code Search Table Added ===");
        lines.push("");
        lines.push(`Table: ${record.table}`);
        lines.push(`Search Fields: ${record.search_fields}`);
        lines.push(`sys_id: ${record.sys_id}`);
        lines.push(`Search Group: ${search_group}`);
        lines.push("");
        lines.push(
          "The table has been added to the search group. Code searches using " +
            "this group will now include results from this table."
        );

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
              text: `Error adding code search table: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
