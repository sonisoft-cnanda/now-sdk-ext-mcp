/**
 * Redirect ServiceNow SDK credential storage off the OS keyring.
 *
 * This matters more for the MCP server than for anything else in the stack: it
 * is started by an MCP client (Claude Code, an IDE) as a non-interactive child
 * process, which is precisely the session that cannot unlock the keyring. The
 * SDK's `KeyChain.getPassword()` swallows the failure and returns null, so every
 * tool call reports "no credentials" instead of a keyring error.
 *
 * Imported for its side effect by src/index.ts, before anything else.
 *
 * The import is dynamic because @sonisoft/sn-credstore is not published yet, and
 * a static import of a missing package is an unrecoverable module-resolution
 * error — it would stop the server from starting at all. Once published and
 * added to dependencies this file collapses to:
 *
 *     import '@sonisoft/sn-credstore/register'
 */

/** Absence is normal today. A shim that loads and then fails is not. */
function isNotInstalled(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException | undefined;
  return (
    err?.code === "ERR_MODULE_NOT_FOUND" &&
    // Only OUR specifier missing means "not installed". The same code from a
    // broken import *inside* sn-credstore means it is installed and broken,
    // which must not be mistaken for absence.
    /@sonisoft[/\\]sn-credstore/.test(String(err.message))
  );
}

try {
  await import("@sonisoft/sn-credstore/register");
} catch (error) {
  if (!isNotInstalled(error)) {
    // Installed but unable to patch. Continuing would silently fall back to the
    // keyring, and the SDK's next write reseeds from a failed read — wiping
    // every other alias. Refusing to start is the safe outcome.
    //
    // stderr, never stdout: stdout is the JSON-RPC transport, and writing a
    // non-protocol byte to it breaks the client's parser.
    const message = error instanceof Error ? error.message : String(error);
    const remediation = (error as { remediation?: string })?.remediation;
    process.stderr.write(
      `now-sdk-ext-mcp: the credential shim failed to install: ${message}\n` +
        (remediation ? `\nRemediation: ${remediation}\n` : "") +
        `\nTo start anyway using the OS keyring, set SN_CRED_STORE_DISABLE=1.\n`
    );
    process.exit(1);
  }

  if (process.env.SN_CRED_STORE_REQUIRE) {
    process.stderr.write(
      `now-sdk-ext-mcp: SN_CRED_STORE_REQUIRE is set but @sonisoft/sn-credstore is not installed.\n` +
        `\nRemediation: npm install @sonisoft/sn-credstore (or npm link it for local development).\n`
    );
    process.exit(1);
  }

  if (process.env.SN_CRED_STORE_DEBUG) {
    process.stderr.write(
      "now-sdk-ext-mcp: @sonisoft/sn-credstore not installed — using the SDK keyring\n"
    );
  }
}

export {};
