import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { constants } from "node:fs";
import { access, copyFile, link, lstat, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
import { getLogger } from "../common/logging.js";

const log = getLogger("working-set");

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

/** A working set as the model should read it; an empty preference means the platform default (Global and its Default). */
export const workingSetLine = (ws: WorkingSet) => ws.application || ws.updateSet
  ? `application ${clean(ws.application) || '""'}, update set ${clean(ws.updateSet) || '""'}`
  : 'none saved (the platform default: Global and its Default set); restore it by passing empty strings';

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
  create_not_applied: "The insert returned no sys_id. Look for the set by name in sys_update_set before retrying.",
  default_update_set:
    "A Default set is not for development work and never ships. Create a set in the application and use that one.",
  duplicate_capture: "The target already holds a capture of this record, or the set holds two. Resolve the duplicate first.",
  evidence_unavailable: "The instance did not return complete evidence. Retry the read; change nothing until it is complete.",
  invalid_input:
    "A value failed validation: the sys_ids, the reason (letters, digits and simple punctuation), the name (1 to 80 " +
    "characters, no control characters), or an application scope name that matches more than one application.",
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
  /** afterExport: the instance side already ran (and cleaned up); only the local file is missing. */
  constructor(
    public readonly code: "output_exists" | "output_invalid" | "output_write_failed" | "export_dir_misconfigured" | "replace_needs_export_dir",
    public afterExport = false,
  ) {
    super(code);
  }
}

const OUTPUT_REMEDIATION: Record<string, string> = {
  output_exists: "The output file exists. Choose another path, or replace it only if the user asked to (inside NEX_EXPORT_DIR).",
  output_invalid:
    "The path must be absolute and end in .xml, inside NEX_EXPORT_DIR when that is set, in an existing writable directory, " +
    "and (to replace) name a regular file. Choose another path.",
  replace_needs_export_dir:
    "Replacing a file is allowed only inside NEX_EXPORT_DIR, which this server does not set. Write a new file instead.",
  export_dir_misconfigured:
    "The server's NEX_EXPORT_DIR is not an absolute, existing directory, so no export path will be accepted until the " +
    "server configuration is fixed. Tell the user; do not try other paths.",
  output_write_failed:
    "The export succeeded on the instance but the file could not be written (disk space or the filesystem). " +
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
    if (error.afterExport && error.code !== "output_write_failed") {
      lines.push("The export already ran on the instance and its temporary copy was cleaned up; no file was written. Export again.");
    }
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
          .regex(/^(|global|[0-9a-f]{32})$/)
          .describe('previous.application from set_current_update_set: global, a sys_scope sys_id, or "" when none was saved.'),
        update_set: z
          .string()
          .regex(/^([0-9a-f]{32})?$/)
          .describe('previous.updateSet from set_current_update_set: a sys_id, or "" when none was saved.'),
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
        "reopened once another instance retrieved or exported it, so complete only when the work is done and reviewed. " +
        "If it was the working set, put the previous one back with restore_update_set.",
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
 * Where an export may go: an absolute path ending in .xml, inside NEX_EXPORT_DIR when that is set. The file holds
 * instance-authored text (every payload), so it must not land on a dotfile, a key file or a script by mistake or by an
 * injected instruction; and a replace may only replace a regular .xml file (or a link, which is replaced, not followed).
 * Checked before the instance copies anything, and again just before the write.
 */
async function checkOutput(output: string, replace: boolean): Promise<string> {
  if (!isAbsolute(output) || /[/\\]$/.test(output) || extname(output).toLowerCase() !== ".xml") throw new OutputError("output_invalid");
  const root = process.env.NEX_EXPORT_DIR;
  // Set but empty (an unexpanded template variable, say) fails closed like any other misconfiguration. Checked first,
  // so a misconfigured server says so whatever path was asked for.
  let realRoot: string | undefined;
  if (root !== undefined) {
    // A relative root would resolve against the working directory the client chose; a missing one refuses every path.
    realRoot = isAbsolute(root) ? await realpath(root).catch(() => undefined) : undefined;
    if (!realRoot || !(await stat(realRoot).then((s) => s.isDirectory(), () => false))) {
      log.warn("NEX_EXPORT_DIR is not an absolute, existing directory; refusing every export");
      throw new OutputError("export_dir_misconfigured");
    }
  } else if (replace) {
    // Without a confined directory, an export may only create a file: replacing one could overwrite any .xml the
    // server user owns (a build's settings.xml, say) with instance-authored content.
    throw new OutputError("replace_needs_export_dir");
  }
  // The directory is resolved (links included) and the write goes through that resolved path. That narrows, but
  // cannot close, the window in which a directory on the path could be swapped for a link (Node has no openat walk);
  // enough against a model choosing paths, not against a local process racing the filesystem.
  const directory = await realpath(dirname(resolve(output))).catch(() => undefined);
  if (!directory || !(await stat(directory).then((s) => s.isDirectory(), () => false))) throw new OutputError("output_invalid");
  if (realRoot) {
    const within = relative(realRoot, directory);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new OutputError("output_invalid");
  }
  const path = join(directory, basename(output));
  if (!(await access(directory, constants.W_OK).then(() => true, () => false))) throw new OutputError("output_invalid");
  const existing = await lstat(path).catch(() => undefined);
  if (existing && !replace) throw new OutputError("output_exists");
  if (existing && !existing.isFile() && !existing.isSymbolicLink()) throw new OutputError("output_invalid");
  return path;
}

/**
 * Write the unload without ever leaving a partial file or replacing one unasked: a private temporary file in the
 * same directory, then a hard link (fails if the target exists; a copy that refuses an existing target where links are
 * not supported) or, with replace, a rename (which replaces a link itself, never its target).
 */
async function writeExport(output: string, xml: string, replace: boolean): Promise<{ path: string; bytes: number }> {
  const path = await checkOutput(output, replace);
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
    if (replace) {
      await rename(temporary, path);
    } else {
      await link(temporary, path).catch(async (error: NodeJS.ErrnoException) => {
        if (error?.code !== "EPERM" && error?.code !== "ENOTSUP" && error?.code !== "EXDEV") throw error;
        await copyFile(temporary, path, constants.COPYFILE_EXCL);
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new OutputError("output_exists");
    throw new OutputError("output_write_failed");
  } finally {
    // Gone whether the write succeeded or not; failing to remove it does not undo a written export.
    await rm(temporary, { force: true }).catch(() => undefined);
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
          .describe("Absolute path of the .xml file to write, e.g. /work/exports/my_set.xml (inside NEX_EXPORT_DIR when the server sets one)."),
        replace: z
          .boolean()
          .optional()
          .describe("Replace the output file if it exists. Only when the user asked to, and only inside NEX_EXPORT_DIR."),
        include_incomplete: z
          .boolean()
          .optional()
          .describe("Export a set that is not Complete, as a snapshot of unfinished work. Only when the user asked for one."),
      },
    },
    async ({ instance, sys_id, output, replace, include_incomplete }) => {
      try {
        // Refuse a bad output before anything is copied on the instance.
        await checkOutput(output, replace === true);

        const result = await withConnectionRetry(
          instance,
          (sn) => new UpdateSetExporter(sn).exportUpdateSet(sys_id, { includeIncomplete: include_incomplete === true }),
          NO_RETRY
        );
        const written = await writeExport(output, result.xml, replace === true).catch((error: unknown) => {
          if (error instanceof OutputError) error.afterExport = true;
          throw error;
        });
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
