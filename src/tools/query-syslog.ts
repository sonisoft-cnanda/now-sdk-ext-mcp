import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SyslogReader } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the query_syslog tool on the MCP server.
 *
 * Queries the ServiceNow syslog table for log entries. Designed to be
 * called repeatedly by an agent to monitor for errors and debug output.
 */
export function registerQuerySyslogTool(server: McpServer): void {
  server.registerTool(
    "query_syslog",
    {
      title: "Query Syslog",
      description:
        "Query the ServiceNow system log (syslog) to check for errors, warnings, " +
        "and debug output. Returns log entries with timestamps, levels, sources, " +
        "and messages. Results are ordered newest-first.\n\n" +
        "Useful for monitoring script execution results, checking for errors after " +
        "deployments, and debugging issues. Can be called repeatedly to check for " +
        "new entries. Use the 'syslog' table for system-level logs and " +
        "'syslog_app_scope' for scoped application logs.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
            '"dev224436", "prod"). If not provided, falls back ' +
            "to the SN_AUTH_ALIAS environment variable."
          ),
        query: z
          .string()
          .optional()
          .describe(
            "A ServiceNow encoded query string for additional filtering. " +
            'Example: "messageLIKEscript error^source=sys_script". ' +
            "This is combined with any level/source filters specified below."
          ),
        level: z
          .enum(["error", "warning", "info", "debug"])
          .optional()
          .describe(
            "Filter by log level. Only returns entries at the specified level."
          ),
        source: z
          .string()
          .optional()
          .describe(
            "Filter by log source (e.g., \"sys_script\", \"workflow\"). " +
            "Exact match."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe(
            "Maximum number of syslog entries to return. Default is 50."
          ),
        table: z
          .enum(["syslog", "syslog_app_scope"])
          .default("syslog")
          .describe(
            'Which syslog table to query. Use "syslog" for the main system log, ' +
            'or "syslog_app_scope" for scoped application logs which include ' +
            "the application scope field."
          ),
      },
    },
    async ({ instance, query, level, source, limit, table }) => {
      try {
        const records = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const syslogReader = new SyslogReader(snInstance);

            // Build encoded query from friendly parameters
            const queryParts: string[] = [];
            if (query) queryParts.push(query);
            if (level) queryParts.push(`level=${level}`);
            if (source) queryParts.push(`source=${source}`);
            queryParts.push("ORDERBYDESCsys_created_on");

            const encodedQuery = queryParts.join("^");

            return table === "syslog_app_scope"
              ? await syslogReader.querySyslogAppScope(encodedQuery, limit)
              : await syslogReader.querySyslog(encodedQuery, limit);
          }
        );

        const lines: string[] = [];
        const filterInfo: string[] = [`Table: ${table}`];
        if (level) filterInfo.push(`Level: ${level}`);
        if (source) filterInfo.push(`Source: ${source}`);
        filterInfo.push(`Records: ${records.length}`);

        lines.push("=== Syslog Query Results ===");
        lines.push(filterInfo.join(" | "));

        if (records.length === 0) {
          lines.push("");
          lines.push("No syslog entries found matching the criteria.");
        } else {
          lines.push("");
          records.forEach((record) => {
            const timestamp = record.sys_created_on || "unknown";
            const lvl = (record.level || "unknown").toUpperCase();
            const src = record.source || "unknown";
            const msg = record.message || "";

            let logLine = `[${timestamp}] ${lvl} | ${src} | ${msg}`;

            // For syslog_app_scope records, include the app_scope
            if ("app_scope" in record && record.app_scope) {
              logLine = `[${timestamp}] ${lvl} | ${src} (${record.app_scope}) | ${msg}`;
            }

            lines.push(logLine);
          });
        }

        lines.push("");
        lines.push(`=== ${records.length} entries returned ===`);

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
              text: `Error querying syslog: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
