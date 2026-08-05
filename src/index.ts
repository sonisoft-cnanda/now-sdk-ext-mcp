#!/usr/bin/env node

// FIRST, deliberately: redirect SDK credential storage off the OS keyring before
// anything can read credentials. An MCP server is always launched as a
// non-interactive child process, where the keyring cannot be unlocked.
import "./common/credstore-boot.js";

// Second, and before anything constructs a core manager: core's loggers are field
// initializers, and until NEX-3 merely constructing one created ./logs/ in whatever
// directory the client happened to launch this server from.
import { flushLogs } from "@sonisoft/now-sdk-ext-core";
import { initLogging, getLogger } from "./common/logging.js";
initLogging();

// Third, before any tool is registered: the permission ladder. Changes are permitted
// by default; NEX_POLICY_DENY in the server's environment is what restricts them, and
// it is the only layer the model cannot reach.
import { guardServer, initPolicy } from "./common/guard.js";
initPolicy();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerServiceNowResources } from "./resources/servicenow.js";
import { TOOL_REGISTRY } from "./tools/registry.js";
import { registerListToolPackagesTool } from "./tools/tool-packages.js";
import { resolveToolPackage, reportResolution } from "./common/tool-packages.js";
import { readServerVersion } from "./common/version.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const log = getLogger("mcp");
const server = new McpServer(
  {
    name: "now-sdk-ext-mcp",
    version: readServerVersion(),
  },
  {
    // Declared explicitly rather than inferred from what happens to get registered.
    //
    // Note progress is NOT a capability — it is base protocol, driven entirely by
    // the client putting a progressToken in a request's _meta. So there is nothing
    // to advertise for it; the server just has to honour the token when it is sent.
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Intentionally the RAW server, not the guard. MCP resources are representational and
// read-only — the ServiceNow ones expose scope, update-set and schema — so there is
// nothing here for a permission check to refuse. Stated explicitly because the loop
// below deliberately does use the guard, and the difference should not read as an
// oversight in a security-relevant path.
registerServiceNowResources(server);

// Tools are registered through the registry rather than 86 direct calls, so a
// package can select a subset. Resolution happens once, before registration —
// filtering after the fact would still pay the import cost and still advertise
// the tools in tools/list.
const activePackage = resolveToolPackage(process.env.MCP_TOOL_PACKAGE);
reportResolution(activePackage);

// Registered through the guard, not the server directly. The Proxy intercepts
// registerTool and wraps each handler with a permission check — a tool cannot opt out,
// and an unclassified tool fails at startup rather than on first use.
const guarded = guardServer(server);
for (const name of activePackage.tools) {
  TOOL_REGISTRY[name](guarded);
}

// Always registered, whatever the package. A filtered session otherwise has no
// way to tell "this server cannot do that" from "that tool is filtered out of
// this session".
registerListToolPackagesTool(guarded, activePackage);


// Prevent the process from crashing silently on unexpected errors.
// Log to stderr (stdout is reserved for JSON-RPC).
// Through the logger, not console.error: an uncaught error here can be an auth or
// HTTP failure carrying a live session, and only the logger redacts.
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception", { error });
});
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", { reason });
});

/** Longest a shutdown will wait on the logger before giving up on it. */
const FLUSH_TIMEOUT_MS = 2000;

/**
 * Flushes buffered log records, then exits — but never lets the flush prevent the exit.
 *
 * Awaiting `flushLogs()` unguarded would make termination depend on that promise
 * settling. Stuck I/O would then turn a graceful SIGTERM into a process that has to be
 * SIGKILLed, which is strictly worse than the lost log lines this exists to save.
 * `unref` so a pending timer cannot itself hold the process open.
 *
 * The rejection is swallowed on purpose: `void p.finally(cb)` re-throws after running
 * the callback, so a failing flush would surface as an unhandled rejection during
 * shutdown. Exiting regardless is the intent, so say so rather than rely on
 * `process.exit` winning the race against the rejection being reported.
 */
async function flushAndExit(code: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      flushLogs(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch {
    // Nothing useful to do while shutting down; the exit below still happens.
  } finally {
    // Tidy even though process.exit follows: leaving it dangling would be one more
    // thing to reason about if this ever grows a path that does not exit.
    if (timer) clearTimeout(timer);
  }
  process.exit(code);
}

// A client stops this server by signalling it, which is the ORDINARY way it exits —
// not an error path. Winston's file transport buffers, so without a flush here the
// last records before shutdown are lost whenever NEX_LOG_FILE is on, which is exactly
// when someone is reading the file to find out what happened.
//
// `once`, so a second signal from an impatient client still terminates immediately
// rather than queueing another flush.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void flushAndExit(0);
  });
}

// Start the server on stdio transport
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("now-sdk-ext-mcp server running on stdio");
}

main().catch((error) => {
  log.error("Fatal error starting server", { error });
  // Flush before exiting: winston buffers, and this is the line that explains why
  // the server is not there. Same timeout guard — a stuck flush must not leave a
  // failed startup hanging instead of exiting non-zero.
  void flushAndExit(1);
});
