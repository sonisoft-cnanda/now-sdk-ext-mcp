import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ATFTestExecutor } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the run_atf_test tool on the MCP server.
 *
 * Executes a single ATF (Automated Test Framework) test by sys_id,
 * waits for completion, and returns the result.
 */
export function registerRunAtfTestTool(server: McpServer): void {
  server.registerTool(
    "run_atf_test",
    {
      title: "Run ATF Test",
      description:
        "Execute a single ServiceNow ATF (Automated Test Framework) test by its sys_id. " +
        "The test runs on the instance, and this tool waits for it to complete before " +
        "returning the result. Returns the test name, status (success/failure), run time, " +
        "and any output produced by the test.\n\n" +
        "Use this tool when the user wants to run a specific ATF test and see its results.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to run the test on. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"dev224436", "prod", "test"). If not provided, falls back ' +
            "to the SN_AUTH_ALIAS environment variable."
          ),
        test_sys_id: z
          .string()
          .describe(
            "The sys_id of the ATF test to execute. This is the unique identifier " +
            "for the test record in the sys_atf_test table."
          ),
      },
    },
    async ({ instance, test_sys_id }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const executor = new ATFTestExecutor(snInstance);
          return await executor.executeTest(test_sys_id);
        });

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Test executed but returned no result. The test may have been cancelled or the progress tracker could not be resolved.",
              },
            ],
            isError: true,
          };
        }

        // Format output matching the CLI's AtfResultFormatterService pattern
        const lines: string[] = [];
        lines.push("=== Test Execution Results ===");
        lines.push(`Test Name: ${result.test_name}`);
        lines.push(`Status: ${result.status}`);
        lines.push(`Run Time: ${result.run_time}`);
        lines.push(`Test Sys ID: ${result.test.value}`);
        lines.push(`Result Sys ID: ${result.sys_id}`);

        if (result.output) {
          lines.push("");
          lines.push("--- Output ---");
          lines.push(result.output);
        }

        lines.push("");
        lines.push("=== Execution Complete ===");

        if (result.status !== "success") {
          lines.push("");
          lines.push("FAILED: Test did not pass.");
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
              text: `Error running ATF test: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the run_atf_test_suite tool on the MCP server.
 *
 * Executes an ATF test suite by name or sys_id, waits for completion,
 * and returns a summary of the results.
 */
export function registerRunAtfTestSuiteTool(server: McpServer): void {
  server.registerTool(
    "run_atf_test_suite",
    {
      title: "Run ATF Test Suite",
      description:
        "Execute a ServiceNow ATF test suite and wait for all tests to complete. " +
        "Identify the suite by either its name or sys_id (provide exactly one). " +
        "Returns a summary with pass/fail/skip/error counts and overall status.\n\n" +
        "Use this tool when the user wants to run a collection of ATF tests as a suite.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to run the suite on. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"dev224436", "prod", "test"). If not provided, falls back ' +
            "to the SN_AUTH_ALIAS environment variable."
          ),
        suite_name: z
          .string()
          .optional()
          .describe(
            "The name of the test suite to execute. Provide either suite_name or " +
            "suite_sys_id, but not both."
          ),
        suite_sys_id: z
          .string()
          .optional()
          .describe(
            "The sys_id of the test suite to execute. Provide either suite_name or " +
            "suite_sys_id, but not both."
          ),
        browser_name: z
          .string()
          .optional()
          .describe("Browser to use for UI tests (e.g., \"Chrome\", \"Firefox\")."),
        browser_version: z
          .string()
          .optional()
          .describe("Browser version for UI tests."),
        os_name: z
          .string()
          .optional()
          .describe("Operating system for UI tests (e.g., \"Windows\", \"Mac\")."),
        os_version: z
          .string()
          .optional()
          .describe("OS version for UI tests."),
        is_performance_run: z
          .boolean()
          .optional()
          .describe("Whether to run as a performance test."),
        run_in_cloud: z
          .boolean()
          .optional()
          .describe("Whether to run tests in the cloud runner."),
      },
    },
    async ({
      instance,
      suite_name,
      suite_sys_id,
      browser_name,
      browser_version,
      os_name,
      os_version,
      is_performance_run,
      run_in_cloud,
    }) => {
      try {
        // Validate that exactly one identifier is provided
        if (!suite_name && !suite_sys_id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: You must provide either suite_name or suite_sys_id to identify the test suite.",
              },
            ],
            isError: true,
          };
        }

        if (suite_name && suite_sys_id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Provide either suite_name or suite_sys_id, not both.",
              },
            ],
            isError: true,
          };
        }

        const result = await withConnectionRetry(instance, async (snInstance) => {
          const executor = new ATFTestExecutor(snInstance);

          // Build optional execution config
          const options: Record<string, string | boolean> = {};
          if (browser_name) options.browser_name = browser_name;
          if (browser_version) options.browser_version = browser_version;
          if (os_name) options.os_name = os_name;
          if (os_version) options.os_version = os_version;
          if (is_performance_run !== undefined)
            options.is_performance_run = is_performance_run;
          if (run_in_cloud !== undefined) options.run_in_cloud = run_in_cloud;

          const hasOptions = Object.keys(options).length > 0;

          return suite_sys_id
            ? await executor.executeTestSuiteAndWait(
                suite_sys_id,
                hasOptions ? options : undefined
              )
            : await executor.executeTestSuiteByNameAndWait(
                suite_name!,
                hasOptions ? options : undefined
              );
        });

        // Format output matching the CLI's AtfResultFormatterService pattern
        const successCount = parseInt(result.success_count || "0", 10);
        const failureCount = parseInt(result.failure_count || "0", 10);
        const skipCount = parseInt(result.skip_count || "0", 10);
        const errorCount = parseInt(result.error_count || "0", 10);
        const totalTests = successCount + failureCount + skipCount + errorCount;

        const lines: string[] = [];
        lines.push("=== Test Suite Execution Results ===");
        lines.push(`Test Suite: ${result.test_suite.value}`);
        lines.push(`Status: ${result.status}`);
        lines.push(`Success: ${result.success}`);
        lines.push(`Run Time: ${result.run_time}`);
        lines.push(`Start Time: ${result.start_time}`);
        lines.push(`End Time: ${result.end_time}`);
        lines.push("");
        lines.push("--- Test Summary ---");
        lines.push(`Total Tests: ${totalTests}`);
        lines.push(`Passed: ${successCount}`);
        lines.push(`Failed: ${failureCount}`);
        lines.push(`Skipped: ${skipCount}`);
        lines.push(`Errors: ${errorCount}`);
        lines.push("");
        lines.push("=== Execution Complete ===");

        if (failureCount === 0 && errorCount === 0) {
          lines.push("");
          lines.push("All tests passed!");
        } else {
          lines.push("");
          lines.push(
            `${failureCount} test(s) failed, ${errorCount} error(s)`
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
              text: `Error running ATF test suite: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
