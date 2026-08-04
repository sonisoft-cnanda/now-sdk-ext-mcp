/**
 * Logging setup for the MCP server.
 *
 * Two things make this different from the CLI.
 *
 * First, there are no flags — an MCP server is launched by a client with an argv it
 * does not control — so configuration is environment only: NEX_LOG_FILE, NEX_LOG_DIR,
 * NEX_LOG_LEVEL, read by core itself.
 *
 * Second, this process is the reason file logging had to become opt-in at all. The
 * server's working directory is chosen by whoever launched it, and core used to create
 * ./logs/ there on import, unconditionally, without this server ever asking to log
 * anything (NEX-3).
 *
 * stdout is the JSON-RPC transport. Everything here goes to stderr, and nothing in this
 * process may ever write to fd 1.
 */

import { Logger, configureLogging } from "@sonisoft/now-sdk-ext-core";

let configured = false;

/**
 * Configures process-wide logging. Call once, before anything constructs a manager.
 *
 * Explicit rather than relying on core reading the environment on its own: the
 * stderr-only guarantee is this server's to make, so it should be stated here where it
 * can be read and tested, not inherited by accident.
 */
export function initLogging(): void {
    if (configured) {
        return;
    }
    configured = true;

    configureLogging({
        // stderr IS this server's log channel — an operator reading `docker logs` or a
        // client's server pane sees only this. `warn` (core's default, right for a CLI
        // where the terminal is the user's) would silence the startup breadcrumbs that
        // say which tool package loaded and whether credentials resolved.
        consoleLevel: process.env.NEX_LOG_LEVEL?.trim() || "info",
        // File logging stays off unless NEX_LOG_FILE/NEX_LOG_DIR asks for it. Core
        // resolves those; naming them here would override an operator's NEX_LOG_FILE=0.
    });
}

/** Returns a named logger. Safe before `initLogging` — core resolves config lazily. */
export function getLogger(name: string): Logger {
    return new Logger(name);
}
