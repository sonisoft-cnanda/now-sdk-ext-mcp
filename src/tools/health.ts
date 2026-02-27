import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InstanceHealth, AggregateQuery } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the check_instance_health tool on the MCP server.
 *
 * Runs a consolidated health check against a ServiceNow instance, returning
 * version info, cluster status, stuck jobs, semaphore count, and operational counts.
 */
export function registerCheckInstanceHealthTool(server: McpServer): void {
  server.registerTool(
    "check_instance_health",
    {
      title: "Check Instance Health",
      description:
        "Run a consolidated health check on a ServiceNow instance. Returns version info, " +
        "cluster node status, stuck scheduled jobs, active semaphore count, and operational " +
        "counts (open incidents, changes, problems).\n\n" +
        "Each section can be individually enabled/disabled. Use this to quickly assess " +
        "the overall health and status of an instance.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        include_version: z
          .boolean()
          .default(true)
          .describe("Include ServiceNow version/build info."),
        include_cluster: z
          .boolean()
          .default(true)
          .describe("Include cluster node status."),
        include_stuck_jobs: z
          .boolean()
          .default(true)
          .describe("Include stuck scheduled jobs."),
        include_semaphores: z
          .boolean()
          .default(true)
          .describe("Include active semaphore count."),
        include_operational_counts: z
          .boolean()
          .default(true)
          .describe("Include operational counts (open incidents, changes, problems)."),
        stuck_job_threshold_minutes: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Threshold in minutes for considering a scheduled job stuck. " +
              "Jobs running longer than this are flagged. Default is 30 minutes."
          ),
      },
    },
    async ({
      instance,
      include_version,
      include_cluster,
      include_stuck_jobs,
      include_semaphores,
      include_operational_counts,
      stuck_job_threshold_minutes,
    }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const aggregateQuery = new AggregateQuery(snInstance);
            const health = new InstanceHealth(snInstance, aggregateQuery);
            return await health.checkHealth({
              includeVersion: include_version,
              includeCluster: include_cluster,
              includeStuckJobs: include_stuck_jobs,
              includeSemaphores: include_semaphores,
              includeOperationalCounts: include_operational_counts,
              stuckJobThresholdMinutes: stuck_job_threshold_minutes,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Instance Health Check ===");
        lines.push(`Timestamp: ${result.timestamp}`);

        if (result.version) {
          lines.push("");
          lines.push("--- Version Info ---");
          if (result.version.version)
            lines.push(`  Version: ${result.version.version}`);
          if (result.version.buildDate)
            lines.push(`  Build Date: ${result.version.buildDate}`);
          if (result.version.buildTag)
            lines.push(`  Build Tag: ${result.version.buildTag}`);
        }

        if (result.clusterNodes) {
          lines.push("");
          lines.push(`--- Cluster Nodes (${result.clusterNodes.length}) ---`);
          for (const node of result.clusterNodes) {
            lines.push(
              `  ${node.node_id || node.sys_id}: status=${node.status || "unknown"}`
            );
          }
        }

        if (result.stuckJobs) {
          lines.push("");
          lines.push(`--- Stuck Jobs (${result.stuckJobs.length}) ---`);
          if (result.stuckJobs.length === 0) {
            lines.push("  None detected");
          } else {
            for (const job of result.stuckJobs) {
              lines.push(
                `  ${job.name || job.sys_id}: state=${job.state || "unknown"}, next_action=${job.next_action || "N/A"}`
              );
            }
          }
        }

        if (result.activeSemaphoreCount !== undefined) {
          lines.push("");
          lines.push("--- Semaphores ---");
          lines.push(`  Active count: ${result.activeSemaphoreCount}`);
        }

        if (result.operationalCounts) {
          lines.push("");
          lines.push("--- Operational Counts ---");
          const counts = result.operationalCounts;
          if (counts.openIncidents !== undefined)
            lines.push(`  Open Incidents: ${counts.openIncidents}`);
          if (counts.openChanges !== undefined)
            lines.push(`  Open Changes: ${counts.openChanges}`);
          if (counts.openProblems !== undefined)
            lines.push(`  Open Problems: ${counts.openProblems}`);
        }

        if (result.summary) {
          lines.push("");
          lines.push(`Summary: ${result.summary}`);
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
              text: `Error checking instance health: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
