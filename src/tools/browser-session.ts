import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, link, lstat, mkdir, open, realpath, rm, stat, unlink } from "node:fs/promises";
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
 * - delete_browser_session removes it again, and only files in that directory.
 * The directory is NEX_BROWSER_SESSION_DIR when set (absolute and existing, or every call is refused), else a private
 * directory under the system temp dir that must be this user's own and closed to others.
 */

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

class SessionFileError extends Error {
  constructor(readonly code: "session_dir_misconfigured" | "session_dir_unsafe" | "session_exists" | "not_a_session_file" | "session_write_failed") {
    super(code);
  }
}

const FILE_ERRORS: Record<SessionFileError["code"], string> = {
  session_dir_misconfigured:
    "The server's NEX_BROWSER_SESSION_DIR is not an absolute, existing, writable directory, so no session is written until the " +
    "server's configuration is fixed.",
  session_dir_unsafe:
    "The server's private session directory is not a directory owned by this user and closed to others, so no session is " +
    "written. Set NEX_BROWSER_SESSION_DIR in the server's environment, or remove the directory and let the server create it.",
  session_exists: "A session file with that name exists, and it is never replaced. Use another name, or delete the old one first.",
  not_a_session_file: "That is not a session file in this server's session directory. Pass the path create_browser_session returned.",
  session_write_failed: "The session file could not be written. Nothing was left behind.",
};

/** The directory sessions live in, resolved, checked on every call. */
async function sessionDirectory(): Promise<string> {
  const configured = process.env.NEX_BROWSER_SESSION_DIR;
  if (configured !== undefined) {
    // Set but empty or relative fails closed, like any other misconfiguration.
    const real = isAbsolute(configured) ? await realpath(configured).catch(() => undefined) : undefined;
    if (!real || !(await stat(real).then((s) => s.isDirectory(), () => false)) || !(await access(real, constants.W_OK).then(() => true, () => false))) {
      throw new SessionFileError("session_dir_misconfigured");
    }
    return real;
  }
  const uid = process.getuid?.();
  const directory = join(tmpdir(), `nex-browser-sessions-${uid ?? "user"}`);
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code !== "EEXIST") throw new SessionFileError("session_dir_unsafe");
  });
  // In a shared temp dir, someone else could have made it first: it must be ours, a real directory, and closed.
  const info = await lstat(directory).catch(() => undefined);
  if (!info || !info.isDirectory() || (uid !== undefined && (info.uid !== uid || (info.mode & 0o077) !== 0))) {
    throw new SessionFileError("session_dir_unsafe");
  }
  return directory;
}

/** Write the state to a new 0600 file without ever leaving a partial one or replacing one. */
async function writeSessionFile(directory: string, name: string, content: string): Promise<string> {
  const path = join(directory, `${name}.json`);
  const temporary = join(directory, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    // A hard link fails if the target exists, so an existing file is never replaced.
    await link(temporary, path);
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new SessionFileError("session_exists");
    throw new SessionFileError("session_write_failed");
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
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
        const fileName = name ?? `${alias.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 30)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const session = await createBrowserSession({ alias });
        const path = await writeSessionFile(directory, fileName, JSON.stringify(session.storageState));
        const cookies = session.storageState.cookies.length;
        return text([
          `Browser session for ${clean(alias)} (${clean(session.instanceUrl)}) written to ${path} (mode 0600, ${cookies} cookie(s)).`,
          `Use it as Playwright storage state: browser.newContext({ storageState: "${path}" }), or test.use({ storageState: "${path}" }).`,
          `It carries the full rights of ${clean(alias)}'s user in the UI. Never print, read out or commit it; delete it with ` +
            "delete_browser_session when the browser work is done.",
          ...(session.oauthExpiresAt ? [`The OAuth token behind it expires ${new Date(session.oauthExpiresAt).toISOString()}.`] : []),
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
        const info = await lstat(target).catch(() => undefined);
        if (!info) return { ...text([`Error (delete_browser_session): no session file at ${clean(target)}; nothing was deleted.`]), isError: true };
        if (!info.isFile()) throw new SessionFileError("not_a_session_file");
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
