import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { SessionAuthError, createBrowserSession } from "@sonisoft/now-sdk-ext-core";
import { annotationsFor } from "../common/annotations.js";
import { clean, cleanMessage, text } from "../common/tool-text.js";
import { instanceParam } from "./working-set.js";

/**
 * Browser sessions for Playwright, as `nex auth browser-session` mints them: core logs in with the alias's stored
 * credential, proves the cookies authenticate on their own, and returns them as a Playwright storage state. That state
 * is a secret with the user's full rights in the UI, so:
 * - it is only ever written to an owner-only file (0600) in one directory this server controls, never returned;
 * - the file is named by the server, never chosen as a path by the model, and an existing file is never replaced;
 * - delete_browser_session removes it again: only a file in that directory that is this user's own, 0600, and a
 *   Playwright storage state, so it cannot remove anything else that happens to live there.
 * The directory is NEX_BROWSER_SESSION_DIR when set, else a private directory under the system temp dir. Either must
 * be this user's own and closed to others (on POSIX), or every call is refused. On Windows there is no owner or mode
 * to check: the per-user temp directory is what keeps it private.
 */

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_STATE_BYTES = 1_000_000;

class SessionFileError extends Error {
  constructor(readonly code: "session_dir_misconfigured" | "session_dir_unsafe" | "session_exists" | "not_a_session_file" | "session_write_failed") {
    super(code);
  }
}

const FILE_ERRORS: Record<SessionFileError["code"], string> = {
  session_dir_misconfigured:
    "The server's NEX_BROWSER_SESSION_DIR is not an absolute, existing, writable directory owned by this user and closed to " +
    "others (0700), so no session is written until the server's configuration is fixed.",
  session_dir_unsafe:
    "The server's private session directory is not a directory owned by this user and closed to others, so no session is " +
    "written. Set NEX_BROWSER_SESSION_DIR in the server's environment, or remove the directory and let the server create it.",
  session_exists: "A session file with that name exists, and it is never replaced. Use another name, or delete the old one first.",
  not_a_session_file:
    "That is not a session file this server wrote: it must be a 0600 Playwright storage state in this server's session " +
    "directory. Pass the path create_browser_session returned.",
  session_write_failed: "The session file could not be written. Nothing was left behind.",
};

/** This user's own directory, closed to group and others. Not checkable on Windows (no uid). */
const isPrivate = (info: { uid: number; mode: number }, uid: number | undefined): boolean =>
  uid === undefined || (info.uid === uid && (info.mode & 0o077) === 0);

/** The directory sessions live in, resolved (links included), checked on every call. */
async function sessionDirectory(): Promise<string> {
  const uid = process.getuid?.();
  const configured = process.env.NEX_BROWSER_SESSION_DIR;
  if (configured !== undefined) {
    // Set but empty or relative fails closed, like any other misconfiguration.
    const real = isAbsolute(configured) ? await realpath(configured).catch(() => undefined) : undefined;
    const info = real ? await stat(real).catch(() => undefined) : undefined;
    if (!real || !info?.isDirectory() || !isPrivate(info, uid) || !(await access(real, constants.W_OK).then(() => true, () => false))) {
      throw new SessionFileError("session_dir_misconfigured");
    }
    return real;
  }
  const directory = join(tmpdir(), `nex-browser-sessions-${uid ?? "user"}`);
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code !== "EEXIST") throw new SessionFileError("session_dir_unsafe");
  });
  // In a shared temp dir, someone else could have made it first: it must be ours, a real directory, and closed.
  const info = await lstat(directory).catch(() => undefined);
  if (!info || !info.isDirectory() || !isPrivate(info, uid)) throw new SessionFileError("session_dir_unsafe");
  // Resolved, so a temp dir reached through a link (macOS /var -> /private/var) compares equal on delete.
  return realpath(directory);
}

/**
 * Write the state straight to a new 0600 file: O_EXCL never replaces a file and never follows a link, and there is
 * no temporary copy to leave behind. A failed write removes what it created.
 */
async function writeSessionFile(directory: string, name: string, content: string): Promise<string> {
  const path = join(directory, `${name}.json`);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    throw new SessionFileError((error as NodeJS.ErrnoException)?.code === "EEXIST" ? "session_exists" : "session_write_failed");
  }
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    return path;
  } catch {
    await handle.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw new SessionFileError("session_write_failed");
  }
}

/** A Playwright storage state as create_browser_session writes it. */
function isStorageState(content: string): boolean {
  try {
    const state = JSON.parse(content) as { cookies?: unknown; origins?: unknown };
    return Array.isArray(state?.cookies) && Array.isArray(state?.origins) && Object.keys(state).length === 2;
  } catch {
    return false;
  }
}

export function registerCreateBrowserSessionTool(server: McpServer): void {
  server.registerTool(
    "create_browser_session",
    {
      annotations: annotationsFor("create_browser_session"),
      title: "Create Browser Session",
      description:
        "Mint a verified Playwright browser session for an instance alias, as nex auth browser-session does: log in with the " +
        "alias's stored credential, prove the cookies work on their own, and save them as a Playwright storage-state file " +
        "(owner-only, 0600) in this server's session directory. Returns the file's path, never the cookies. The session has " +
        "the user's full rights in the UI, outside this server's change policy, so it is refused when changes are not " +
        "permitted. Never print, read out or commit the file, and delete it with delete_browser_session when the browser " +
        "work is done.",
      inputSchema: {
        instance: instanceParam,
        name: z
          .string()
          .regex(NAME, "letters, digits, - and _, up to 64")
          .optional()
          .describe("File name, without extension. Default: the alias and a timestamp."),
      },
    },
    async ({ instance, name }) => {
      const alias = instance || process.env.SN_AUTH_ALIAS;
      if (!alias) {
        return { ...text(["Error (create_browser_session): no instance given and SN_AUTH_ALIAS is not set. Nothing was written."]), isError: true };
      }
      try {
        // Checked before logging in, so a misconfigured directory costs no session.
        const directory = await sessionDirectory();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fromAlias = `${alias.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 30)}-${stamp}`;
        // A default name must also be deletable: one that would not pass NAME (an alias starting with _, say) is not used.
        const fileName = name ?? (NAME.test(fromAlias) ? fromAlias : `session-${stamp}`);
        // A taken name is refused before logging in, so no UI session is opened for nothing. O_EXCL stays the real guard.
        if (await lstat(join(directory, `${fileName}.json`)).then(() => true, () => false)) throw new SessionFileError("session_exists");
        const session = await createBrowserSession({ alias });
        const path = await writeSessionFile(directory, fileName, JSON.stringify(session.storageState));
        const cookies = session.storageState.cookies.length;
        return text([
          `Browser session for ${clean(alias)} (${clean(session.instanceUrl)}) written to ${path} (mode 0600, ${cookies} cookie(s)).`,
          `Use it as Playwright storage state: browser.newContext({ storageState: "${path}" }), or test.use({ storageState: "${path}" }).`,
          `It carries the full rights of ${clean(alias)}'s user in the UI. Never print, read out or commit it; delete it with ` +
            "delete_browser_session when the browser work is done.",
          // The SDK keeps expires_at in seconds.
          ...(session.oauthExpiresAt
            ? [`The OAuth token behind it expires ${new Date(session.oauthExpiresAt < 1e12 ? session.oauthExpiresAt * 1000 : session.oauthExpiresAt).toISOString()}.`]
            : []),
          "The UI session ends at the instance's idle timeout; mint a new one then.",
        ]);
      } catch (error) {
        if (error instanceof SessionFileError) {
          return { ...text([`Error (create_browser_session): ${error.code}: ${FILE_ERRORS[error.code]}`]), isError: true };
        }
        if (error instanceof SessionAuthError) {
          return {
            ...text([`Error (create_browser_session): ${error.code}: ${cleanMessage(error.remediation)}`, "Nothing was written."]),
            isError: true,
          };
        }
        return {
          ...text([`Error (create_browser_session): ${cleanMessage(error instanceof Error ? error.message : String(error))}`, "Nothing was written."]),
          isError: true,
        };
      }
    }
  );
}

export function registerDeleteBrowserSessionTool(server: McpServer): void {
  server.registerTool(
    "delete_browser_session",
    {
      annotations: annotationsFor("delete_browser_session"),
      title: "Delete Browser Session",
      description:
        "Delete a browser session file that create_browser_session wrote, once the browser work is done. Only a .json file " +
        "in this server's session directory is deleted. The instance's UI session itself ends at its idle timeout.",
      inputSchema: {
        path: z.string().min(1).max(4096).describe("The path create_browser_session returned."),
      },
    },
    async ({ path }) => {
      try {
        const directory = await sessionDirectory();
        if (!isAbsolute(path) || extname(path) !== ".json" || !NAME.test(basename(path, ".json"))) throw new SessionFileError("not_a_session_file");
        const parent = await realpath(dirname(path)).catch(() => undefined);
        if (parent !== directory) throw new SessionFileError("not_a_session_file");
        const target = join(directory, basename(path));
        // Only what create_browser_session writes: a regular file of ours, 0600, holding a storage state. Checked through
        // one handle opened without following a link, so the file read is the file checked.
        let handle;
        try {
          handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code;
          if (code === "ENOENT") return { ...text([`Error (delete_browser_session): no session file at ${clean(target)}; nothing was deleted.`]), isError: true };
          throw new SessionFileError("not_a_session_file");
        }
        try {
          const info = await handle.stat();
          const uid = process.getuid?.();
          if (!info.isFile() || info.size > MAX_STATE_BYTES || (uid !== undefined && (info.uid !== uid || (info.mode & 0o777) !== 0o600))) {
            throw new SessionFileError("not_a_session_file");
          }
          if (!isStorageState(await handle.readFile("utf8"))) throw new SessionFileError("not_a_session_file");
        } finally {
          await handle.close();
        }
        await unlink(target);
        return text([`Deleted the browser session file ${target}.`]);
      } catch (error) {
        if (error instanceof SessionFileError) {
          return { ...text([`Error (delete_browser_session): ${error.code}: ${FILE_ERRORS[error.code]}`]), isError: true };
        }
        return {
          ...text([`Error (delete_browser_session): ${cleanMessage(error instanceof Error ? error.message : String(error))}`]),
          isError: true,
        };
      }
    }
  );
}
