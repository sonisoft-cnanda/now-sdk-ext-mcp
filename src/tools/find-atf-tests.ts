import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TableAPIRequest } from "@sonisoft/now-sdk-ext-core";
import {
  withConnectionRetry,
  isRetryableResponse,
} from "../common/connection.js";

interface ATFTestRecord {
  sys_id: string;
  name: string;
  description: string;
  active: string;
  category?: string;
  sys_updated_on?: string;
}

interface ATFTestResponse {
  result: ATFTestRecord[];
}

/**
 * Registers the find_atf_tests tool on the MCP server.
 *
 * Searches the sys_atf_test table to find ATF tests by name, description,
 * or category. Returns results that can be fed into run_atf_test.
 */
export function registerFindAtfTestsTool(server: McpServer): void {
  server.registerTool(
    "find_atf_tests",
    {
      title: "Find ATF Tests",
      description:
        "Search for ATF (Automated Test Framework) tests on a ServiceNow instance. " +
        "Find tests by name, description, or category. Returns a list of matching tests " +
        "with their sys_ids, which can then be passed to the run_atf_test tool for execution.\n\n" +
        "Use this when you need to discover which ATF tests exist before running them.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
            '"dev224436", "prod"). If not provided, falls back ' +
            "to the SN_AUTH_ALIAS environment variable."
          ),
        search_term: z
          .string()
          .optional()
          .describe(
            "Text to search for in test name and description fields. " +
            "Case-insensitive contains matching. " +
            'Example: "incident" finds tests with "incident" in the name or description.'
          ),
        category: z
          .string()
          .optional()
          .describe(
            'Filter by test category (e.g., "Custom", "Module"). ' +
            "Maps to the sys_atf_test.category field."
          ),
        active: z
          .boolean()
          .default(true)
          .describe(
            "Filter by active status. Defaults to true (only active tests). " +
            "Set to false to find only inactive tests."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum number of tests to return. Default is 25."),
      },
    },
    async ({ instance, search_term, category, active, limit }) => {
      try {
        const response = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const tableApi = new TableAPIRequest(snInstance);

            // Build encoded query using ^NQ for safe OR grouping when search_term
            // is provided. This ensures active/category filters apply to both
            // name and description branches.
            let encodedQuery: string;
            if (search_term) {
              encodedQuery = `active=${active}^nameLIKE${search_term}`;
              if (category) encodedQuery += `^category=${category}`;
              encodedQuery += `^NQactive=${active}^descriptionLIKE${search_term}`;
              if (category) encodedQuery += `^category=${category}`;
            } else {
              encodedQuery = `active=${active}`;
              if (category) encodedQuery += `^category=${category}`;
            }
            encodedQuery += "^ORDERBYname";

            const queryParams: Record<string, string | number> = {
              sysparm_query: encodedQuery,
              sysparm_fields:
                "sys_id,name,description,active,category,sys_updated_on",
              sysparm_limit: limit,
              sysparm_display_value: "false",
            };

            const resp = await tableApi.get<ATFTestResponse>(
              "sys_atf_test",
              queryParams
            );

            if (isRetryableResponse(resp)) {
              const status = resp?.status ?? "unknown";
              throw new Error(`HTTP ${status} searching ATF tests`);
            }

            return resp;
          }
        );

        if (response.status !== 200) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error searching ATF tests: HTTP ${response.status}`,
              },
            ],
            isError: true,
          };
        }

        const tests = response.bodyObject?.result ?? [];
        const lines: string[] = [];

        lines.push("=== ATF Test Search Results ===");
        const searchInfo: string[] = [];
        if (search_term) searchInfo.push(`Search: "${search_term}"`);
        if (category) searchInfo.push(`Category: "${category}"`);
        searchInfo.push(`Active: ${active}`);
        lines.push(searchInfo.join(" | "));
        lines.push(`Found: ${tests.length} test(s)`);

        if (tests.length === 0) {
          lines.push("");
          lines.push("No ATF tests found matching the criteria.");
        } else {
          tests.forEach((test, index) => {
            lines.push("");
            lines.push(`${index + 1}. ${test.name}`);
            lines.push(`   sys_id: ${test.sys_id}`);
            lines.push(`   Active: ${test.active}`);
            if (test.description) {
              const truncated =
                test.description.length > 100
                  ? test.description.substring(0, 100) + "..."
                  : test.description;
              lines.push(`   Description: ${truncated}`);
            }
          });
        }

        lines.push("");
        lines.push(`=== ${tests.length} test(s) found ===`);
        if (tests.length > 0) {
          lines.push("");
          lines.push(
            "Tip: Use the sys_id with the run_atf_test tool to execute a test."
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
              text: `Error finding ATF tests: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
