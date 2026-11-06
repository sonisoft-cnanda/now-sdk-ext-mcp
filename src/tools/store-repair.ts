import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ApplicationManager,
  StoreAppRepairError,
  isPolicyRefusal,
  type StoreAppRepairResult,
  type StoreAppRepairStart,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";
import { progressReporter } from "../common/progress.js";
import { instanceParam } from "./working-set.js";
import { clean, cleanMessage, text } from "../common/tool-text.js";

/**
 * Repair an installed Store or company application, as `nex store repair` does: the platform's Repair Application
 * reinstalls the installed version from the application repository without uninstalling it. Core resolves the
 * application, refuses what the platform would not repair, waits for the tracker, and reads back the upgrade history
 * the repair wrote. The start is never replayed after a transport error: a repair that started would run twice.
 */

const appLine = (app: StoreAppRepairStart["app"]) =>
  `${clean(app.name)} (${clean(app.scope)}) ${clean(app.version)}${app.customizationVersion ? `, customization ${clean(app.customizationVersion)}` : ""}`;

function resultLines(result: StoreAppRepairResult): string[] {
  const lines: string[] = [];
  // Only `repaired` is evidence: the tracker succeeded AND a new upgrade history row was written and finished.
  if (result.repaired) lines.push(`Repaired: ${appLine(result.app)}`);
  else if (result.success) {
    lines.push(`Not confirmed as repaired (the tracker succeeded but no finished upgrade history was found): ${appLine(result.app)}`);
  }
  // Mirrors nex's repairOutcome (now-sdk-ext-cli src/services/store-app-repair-display.service.ts): still running
  // means under 100% and not a final sys_execution_tracker state, 3 (failed) or 4 (cancelled).
  else if (result.percent_complete < 100 && result.status !== "3" && result.status !== "4") {
    lines.push(`Still running when the wait ended: ${appLine(result.app)}. Do not start another repair; check sys_execution_tracker ${clean(result.trackerId)}.`);
  }
  else lines.push(`Repair failed: ${appLine(result.app)}${result.error ? `: ${cleanMessage(result.error)}` : ""}`);
  lines.push(
    `Tracker ${clean(result.trackerId)}: ${clean(result.status_label) || clean(result.status)} (${result.percent_complete}%)` +
      `${result.status_message ? `, ${cleanMessage(result.status_message)}` : ""}`
  );
  const history = result.history;
  if (history) {
    const c = history.counts;
    lines.push(
      `Upgrade history ${clean(history.sysId)}: ${c.added} added, ${c.updated} updated, ${c.deleted} deleted, ${c.unchanged} unchanged, ` +
        `${c.skipped} skipped (${c.skippedError} error, ${c.skippedManualMerge} manual merge, ${c.skippedApplyOnce} apply once)`
    );
    if (history.skippedFiles.length) {
      lines.push("Not applied:");
      for (const file of history.skippedFiles.slice(0, 50)) {
        lines.push(`- ${clean(file.dispositionLabel)} ${clean(file.type)}: ${cleanMessage(file.targetName)}${file.reason ? `: ${cleanMessage(file.reason)}` : ""}`);
      }
      if (history.skippedFilesTruncated || history.skippedFiles.length > 50) {
        lines.push(`... more: see sys_upgrade_history_log where upgrade_history=${clean(history.sysId)}`);
      }
    }
  } else {
    lines.push("Upgrade history: none written for this repair.");
  }
  for (const warning of result.warnings) lines.push(`WARNING: ${cleanMessage(warning)}`);
  return lines;
}

export function registerRepairStoreAppTool(server: McpServer): void {
  server.registerTool(
    "repair_store_app",
    {
      annotations: annotationsFor("repair_store_app"),
      title: "Repair Store Application",
      description:
        "Repair an installed Store or company application (the platform's Repair Application): reinstall its installed " +
        "version from the application repository, without uninstalling it, and wait for the result. Files that were " +
        "customized on the instance are kept (listed as skipped). Trust only a result that says Repaired: it requires the " +
        "tracker to succeed and a new upgrade history to be written. Refused for an application developed on this instance, " +
        "an inactive one, or one that contains plugins. Only when the user asked for a repair; it runs whatever the " +
        "application's install runs.",
      inputSchema: {
        instance: instanceParam,
        app: z
          .string()
          .regex(/^([0-9a-f]{32}|[a-z0-9_]{1,40})$/, "a sys_store_app sys_id or a scope name")
          .describe("The installed application: its scope (e.g. sn_grc) or its sys_store_app sys_id."),
        load_demo_data: z.boolean().optional().describe("Also load the application's demo data. Refused when it has none."),
        timeout_minutes: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe(
            "How long to wait for the repair. Default 30. Progress is reported while waiting; a client that does not reset " +
              "its timeout on progress may give up first, and the repair then keeps running: check sys_execution_tracker."
          ),
      },
    },
    async ({ instance, app, load_demo_data, timeout_minutes }, extra) => {
      let started: StoreAppRepairStart | undefined;
      try {
        const progress = progressReporter(extra);
        // Started, then waited for, in two steps so a failure while waiting can still name the tracker. Only the start
        // is never replayed; waiting only reads.
        started = await withConnectionRetry(
          instance,
          (sn) => new ApplicationManager(sn).repairStoreApplication({ app, loadDemoData: load_demo_data === true }),
          { retry: false }
        );
        const repair = started;
        const result = await withConnectionRetry(instance, (sn) =>
          new ApplicationManager(sn).waitForStoreApplicationRepair(
            repair,
            5000,
            (timeout_minutes ?? 30) * 60 * 1000,
            progress ? (p) => progress(p.percentComplete !== undefined ? `${p.message} (${p.percentComplete}%)` : p.message) : undefined
          )
        );
        // As nex: anything short of Repaired (not confirmed, still running, failed) is not a success.
        return { ...text(resultLines(result)), ...(result.repaired ? {} : { isError: true }) };
      } catch (error) {
        const lines: string[] = [];
        if (started) {
          lines.push(
            `Error (repair_store_app): the repair of ${appLine(started.app)} started (sys_execution_tracker ${clean(started.trackerId)}) ` +
              `but waiting for it failed: ${cleanMessage(error instanceof Error ? error.message : String(error))}`,
            "Do not start another repair: check that tracker and the application's upgrade history."
          );
        } else if (error instanceof StoreAppRepairError) {
          lines.push(`Error (repair_store_app): ${error.code}: ${cleanMessage(error.message)}`);
          if (error.detail?.serverMessage) lines.push(`App Client said: ${cleanMessage(error.detail.serverMessage)}`);
          if (error.detail?.status !== undefined) lines.push(`HTTP status: ${error.detail.status}`);
          if (error.code === "start_failed") lines.push("The repair may not have started: check sys_execution_tracker before trying again.");
        } else if (isPolicyRefusal(error)) {
          lines.push(`Error (repair_store_app): refused by policy: ${cleanMessage((error as Error).message)}`);
        } else {
          lines.push(`Error (repair_store_app): ${cleanMessage(error instanceof Error ? error.message : String(error))}`);
          lines.push("The repair may have started before this failed: check sys_execution_tracker and the application's upgrade history before trying again.");
        }
        return { ...text(lines), isError: true };
      }
    }
  );
}
