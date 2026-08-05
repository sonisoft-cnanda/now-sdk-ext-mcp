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

/**
 * Returns a named logger.
 *
 * Safe to call before `initLogging()`, and several modules do: ES modules evaluate
 * every import before the importing module's own top-level statements, so the
 * `const log = getLogger(...)` in connection.ts, progress.ts and tool-packages.ts all
 * run BEFORE the `initLogging()` call in index.ts, even though it sits above them in
 * source order.
 *
 * That is fine because nothing is decided at construction time. `Logger` only stores a
 * label; core builds the underlying winston logger on the first WRITE, resolves config
 * lazily at that point, and rebuilds when configuration changes. So a logger built
 * during import picks up whatever `initLogging()` sets, provided nothing logs during
 * module evaluation — and nothing does.
 *
 * This is not left to inspection: the "still reports startup breadcrumbs on stderr"
 * case in test/unit/common/logging.test.ts only passes if `consoleLevel: info` from
 * `initLogging()` reached a logger that was constructed before it ran. Core's default
 * is `warn`, which would suppress those lines.
 */
export function getLogger(name: string): Logger {
    return new Logger(name);
}
