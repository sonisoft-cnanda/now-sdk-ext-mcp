import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { constants } from "node:fs";
import { access, link, lstat, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  UpdateSetExportError,
  UpdateSetExporter,
  WorkingSetError,
  WorkingSetManager,
  isPolicyRefusal,
  redactMessage,
  type UpdateSetSummary,
  type WorkingSet,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";

/**
 * The update-set lifecycle, as `nex update-set use|restore|complete|move-capture|export` does it: every
 * step goes through core's WorkingSetManager / UpdateSetExporter, which refuse what the platform would
 * get wrong and read the outcome back. Writes are not replayed after a transport error (retry: false):
 * the first attempt may have landed.
 */

const NO_RETRY = { retry: false };

export const instanceParam = z
  .string()
  .optional()
  .describe(
    "The ServiceNow instance auth alias to connect to. " +
      "This is the alias configured via `snc configure` (e.g., " +
      '"myinstance", "prod", "test"). The user will typically refer to ' +
      'this by name when saying things like "on my myinstance instance". ' +
      "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
  );

const SYS_ID = /^[0-9a-f]{32}$/;
const sysId = (what: string) => z.string().regex(SYS_ID, "a 32-character sys_id").describe(what);

// Values come from the instance: one line each, no control characters.
const clean = (text: string | undefined): string => (text ?? "").replace(/\p{Cc}/gu, " ");
const cleanMessage = (text: string): string =>
  redactMessage(text).replace(/<[^>]*>/g, "[omitted]").replace(/<[^>]*$/, "[omitted]").replace(/\p{Cc}/gu, " ");

export function setLine(set: UpdateSetSummary): string {
  return `${clean(set.name)} (${set.sysId}); state: ${clean(set.state)}; application: ${clean(set.application)}` +
    `${set.isDefault ? "; Default" : ""}`;
}

const workingSetLine = (ws: WorkingSet) => `application ${clean(ws.application)}, update set ${clean(ws.updateSet)}`;

function text(lines: string[]) {
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

const WORKING_SET_REMEDIATION: Record<string, string> = {
  application_not_applied: "The set did not read back in the requested application. Inspect sys_update_set before retrying.",
  application_not_found: "Name global, a sys_scope sys_id, or a scope name that matches exactly one active application.",
  capture_count_mismatch:
    "The set holds a different number of captures than you reviewed (expected vs actual). List them again before completing.",
  capture_not_in_source: "The capture is not in the source set. Read sys_update_xml.update_set for it.",
  complete_not_applied: "A business rule may have refused completion. Read the message in the UI or syslog.",
  default_update_set:
    "A Default set is not for development work and never ships. Create a set in the application and use that one.",
  duplicate_capture: "The target already holds a capture of this record, or the set holds two. Resolve the duplicate first.",
  evidence_unavailable: "The instance did not return complete evidence. Retry the read; change nothing until it is complete.",
  invalid_input: "Check the sys_ids, the application and the reason (letters, digits and simple punctuation).",
  mixed_scope_capture: "The set holds captures of other applications (listed): move them to their own Default first.",
  move_not_applied:
    'The platform aborted the move. Read the row back; a set of another scope is refused by "Handle updates moving between sets".',
  newer_capture_exists: "A newer capture of the same record exists elsewhere. Recapture the record with the target set current instead.",
  no_single_default: "The application has no single In progress Default to fall back to. Restore with an In progress set of that application.",
  scope_mismatch: "A capture can move only to a set of its own application (named). Create a set in that application.",
  script_result_unavailable:
    "The background script result could not be read. Check get_current_update_set and syslog before retrying.",
  update_set_closed:
    "The set is not In progress. Put further changes in a new set; reopen this one in the UI only if it has never been " +
    "retrieved by another instance or exported.",
  update_set_exists: "An In progress set with this name already exists in the application. Use it, or choose another name.",
  update_set_in_use: "Another user is working in this set. Ask them to switch sets before completing.",
  update_set_not_found: "No update set has that sys_id.",
  working_set_not_applied: "The preferences did not read back. Check get_current_update_set before making any change.",
};

const EXPORT_REMEDIATION: Record<string, string> = {
  batch_member: "The set belongs to a batch: export the batch base (named), which includes it.",
  cleanup_unverified:
    "A temporary copy may remain under Retrieved Update Sets (sys_remote_update_set rows listed): delete them, and do not preview or commit them.",
  evidence_unavailable: "The instance did not return complete evidence, and nothing was copied. Retry.",
  export_failed:
    "The download failed and the temporary copy was removed. The processors need admin, delegated_developer or update_set_admin.",
  export_mismatch: "The file did not hold exactly the set's records, so nothing was written. Retry; if it repeats, inspect the set.",
  invalid_input: "Pass the 32-character sys_id of a sys_update_set or a sys_remote_update_set.",
  retrieved_state: "The platform exports a Retrieved Update Set only while it is Loaded. Export the source set on its own instance.",
  script_result_unavailable:
    "The background script's result could not be read. If temporary sys_ids are listed, they are Retrieved Update Set copies of this set: check and delete them.",
  update_set_incomplete: "The platform exports only Complete sets. Complete it first, or export a snapshot of unfinished work if the user asks for one.",
  update_set_not_found: "No local or retrieved update set has that sys_id.",
};

class OutputError extends Error {
  constructor(public readonly code: "output_exists" | "output_invalid" | "output_write_failed") {
    super(code);
  }
}

const OUTPUT_REMEDIATION: Record<string, string> = {
  output_exists: "The output file exists. Choose another path, or replace it only if the user asked to.",
  output_invalid: "The directory does not exist or is not writable, or the path is a directory. Choose another path.",
  output_write_failed:
    "The export succeeded on the instance but the file could not be written (permissions, disk space or the filesystem). " +
    "Nothing was left on the instance; fix the location and export again.",
};

/** Identifiers and counts only (the cores' detail objects never carry names or payloads). */
function detailLine(detail: object | undefined): string[] {
  if (!detail) return [];
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${clean(typeof v === "object" ? JSON.stringify(v) : String(v))}`);
  return parts.length ? [`Detail: ${parts.join("; ")}`] : [];
}

export function workingSetErrorText(action: string, error: unknown) {
  const lines: string[] = [];
  if (error instanceof WorkingSetError) {
    lines.push(`Error (${action}): ${error.code}`, ...detailLine(error.detail));
    if (WORKING_SET_REMEDIATION[error.code]) lines.push(WORKING_SET_REMEDIATION[error.code]);
    if (error.detail?.previous) {
      lines.push(`The working set before this call was ${workingSetLine(error.detail.previous)}: restore it with restore_update_set.`);
    }
  } else if (error instanceof UpdateSetExportError) {
    lines.push(`Error (${action}): ${error.code}`, ...detailLine(error.detail));
    if (EXPORT_REMEDIATION[error.code]) lines.push(EXPORT_REMEDIATION[error.code]);
  } else if (error instanceof OutputError) {
    lines.push(`Error (${action}): ${error.code}`, OUTPUT_REMEDIATION[error.code]);
  } else if (isPolicyRefusal(error)) {
    lines.push(`Error (${action}): refused by policy: ${cleanMessage((error as Error).message)}`);
  } else {
    lines.push(`Error (${action}): ${cleanMessage(error instanceof Error ? error.message : String(error))}`);
    if (action !== "export_update_set") {
      lines.push("The change may have been applied before this failed: read the update set back before retrying.");
    }
  }
  return { ...text(lines), isError: true };
}

export function registerRestoreUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "restore_update_set",
    {
      annotations: annotationsFor("restore_update_set"),
      title: "Restore Update Set",
      description:
        "Put back the working set (application and update set) that set_current_update_set reported as the previous one. " +
        "If that set has closed meanwhile, the application's Default becomes current instead, and the result says so.",
      inputSchema: {
        instance: instanceParam,
        application: z
          .string()
          .regex(/^(global|[0-9a-f]{32})$/)
          .describe("previous.application from set_current_update_set: global or a sys_scope sys_id."),
        update_set: sysId("previous.updateSet from set_current_update_set."),
      },
    },
    async ({ instance, application, update_set }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          (sn) => new WorkingSetManager(sn).restoreWorkingSet({ application, updateSet: update_set }),
          NO_RETRY
        );
        return text([
          `Working set restored: ${workingSetLine(result.restored)}.`,
          ...(result.fallback === "application_default"
            ? ["The previous set had closed, so the application's Default set is current instead."]
            : []),
        ]);
      } catch (error) {
        return workingSetErrorText("restore_update_set", error);
      }
    }
  );
}

export function registerCompleteUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "complete_update_set",
    {
      annotations: annotationsFor("complete_update_set"),
      title: "Complete Update Set",
      description:
        "Complete an In progress, non-Default update set after checking what it holds: the capture count must equal " +
        "expected_captures (the number you reviewed, e.g. with inspect_update_set), no other user may be working in it, " +
        "and every capture must belong to the set's application. The state is read back. A Complete set should not be " +
        "reopened once another instance retrieved or exported it, so complete only when the work is done and reviewed.",
      inputSchema: {
        instance: instanceParam,
        sys_id: sysId("The In progress, non-Default update set to complete."),
        expected_captures: z.number().int().min(0).describe("The number of captures (sys_update_xml rows) you reviewed in the set."),
      },
    },
    async ({ instance, sys_id, expected_captures }) => {
      try {
        const set = await withConnectionRetry(
          instance,
          (sn) => new WorkingSetManager(sn).completeUpdateSet(sys_id, { expectedCaptures: expected_captures }),
          NO_RETRY
        );
        return text([`Update set completed (read back): ${setLine(set)}`]);
      } catch (error) {
        return workingSetErrorText("complete_update_set", error);
      }
    }
  );
}

export function registerMoveUpdateSetCaptureTool(server: McpServer): void {
  server.registerTool(
    "move_update_set_capture",
    {
      annotations: annotationsFor("move_update_set_capture"),
      title: "Move Update Set Capture",
      description:
        "Move one capture (sys_update_xml) from one In progress set to another In progress, non-Default set of its own " +
        "application, then read it back. Refused when a newer capture of the same record exists elsewhere, when the " +
        "target already holds one, or across applications. The reason is appended to the capture's comments.",
      inputSchema: {
        instance: instanceParam,
        capture: sysId("The sys_update_xml sys_id."),
        source_set: sysId("The set the capture is in now."),
        target_set: sysId("The In progress, non-Default set of the same application to move it to."),
        reason: z
          .string()
          .regex(/^[\w .,;:()'/-]{1,200}$/, "letters, digits and simple punctuation, at most 200 characters")
          .describe("Why the capture moves."),
      },
    },
    async ({ instance, capture, source_set, target_set, reason }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          (sn) => new WorkingSetManager(sn).moveCapture({ capture, sourceSet: source_set, targetSet: target_set, reason }),
          NO_RETRY
        );
        return text([
          `Capture ${result.capture} (${clean(result.name)}) moved and read back.`,
          `From: ${setLine(result.from)}`,
          `To: ${setLine(result.to)}`,
        ]);
      } catch (error) {
        return workingSetErrorText("move_update_set_capture", error);
      }
    }
  );
}

/**
 * Write the unload without ever leaving a partial file or replacing one unasked: a private temporary file in the
 * same directory, then a link (fails if the target exists) or, with replace, a rename.
 */
async function writeExport(output: string, xml: string, replace: boolean): Promise<{ path: string; bytes: number }> {
  if (/[/\\]$/.test(output)) throw new OutputError("output_invalid");
  const path = resolve(output);
  const parent = await stat(dirname(path)).catch(() => undefined);
  if (!parent?.isDirectory()) throw new OutputError("output_invalid");
  if (!(await access(dirname(path), constants.W_OK).then(() => true, () => false))) throw new OutputError("output_invalid");
  const existing = await lstat(path).catch(() => undefined);
  if (existing?.isDirectory()) throw new OutputError("output_invalid");
  if (existing && !replace) throw new OutputError("output_exists");
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    // 0600: the unload holds every record's full payload.
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(xml, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (replace) await rename(temporary, path);
    else await link(temporary, path).then(() => rm(temporary, { force: true }));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new OutputError("output_exists");
    throw new OutputError("output_write_failed");
  }
  return { path, bytes: Buffer.byteLength(xml, "utf8") };
}

export function registerExportUpdateSetTool(server: McpServer): void {
  server.registerTool(
    "export_update_set",
    {
      annotations: annotationsFor("export_update_set"),
      title: "Export Update Set to XML",
      description:
        "Export an update set to an XML file on this machine, as the platform's Export to XML does: a Complete local set, " +
        "a batch base with its Complete children, or a Retrieved (Loaded) update set. The file is checked against the " +
        "set's records before it is written, and a local export's temporary copy on the instance is removed and read back. " +
        "The XML holds every record's full payload: it is written to the file only (mode 0600), never returned. Only " +
        "export from a customer instance with the user's say-so.",
      inputSchema: {
        instance: instanceParam,
        sys_id: sysId("sys_id of a sys_update_set, or of a Retrieved Update Set (sys_remote_update_set)."),
        output: z
          .string()
          .min(1)
          .describe("The file to write, e.g. /work/exports/my_set.xml. A relative path resolves against the server's working directory."),
        replace: z.boolean().optional().describe("Replace the output file if it exists. Only when the user asked to."),
        include_incomplete: z
          .boolean()
          .optional()
          .describe("Export a set that is not Complete, as a snapshot of unfinished work. Only when the user asked for one."),
      },
    },
    async ({ instance, sys_id, output, replace, include_incomplete }) => {
      try {
        // Refuse a bad output before anything is copied on the instance.
        const path = resolve(output);
        const parent = await stat(dirname(path)).catch(() => undefined);
        if (/[/\\]$/.test(output) || !parent?.isDirectory()) throw new OutputError("output_invalid");
        if (!replace && (await lstat(path).catch(() => undefined))) throw new OutputError("output_exists");

        const result = await withConnectionRetry(
          instance,
          (sn) => new UpdateSetExporter(sn).exportUpdateSet(sys_id, { includeIncomplete: include_incomplete === true }),
          NO_RETRY
        );
        const written = await writeExport(output, result.xml, replace === true);
        const lines = [
          `Exported ${result.kind === "batch" ? "a batch" : "an update set"} (${result.source}) to ${written.path} (${written.bytes} bytes).`,
          `Update set: ${clean(result.updateSet.name)} (${result.updateSet.sysId}); state: ${clean(result.updateSet.state)}`,
          `Records: ${result.recordCount}`,
          ...result.sets.map((s) => `- ${clean(s.name)} (${s.sysId}); ${clean(s.state)}; ${s.records} record(s)`),
          ...(result.excluded.length
            ? [`Left out (not Complete): ${result.excluded.map((s) => `${clean(s.name)} (${s.sysId})`).join(", ")}`]
            : []),
          ...(result.cleanup ? [`Temporary copy ${result.cleanup.temporarySysId} removed by ${result.cleanup.removedBy} (read back).`] : []),
        ];
        return text(lines);
      } catch (error) {
        return workingSetErrorText("export_update_set", error);
      }
    }
  );
}
