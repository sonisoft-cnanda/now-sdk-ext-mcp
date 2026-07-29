/**
 * Opt in to headless-safe credential storage.
 *
 * By default this server uses the ServiceNow SDK exactly as it ships, reading
 * credentials from the OS keyring. Set SN_CRED_STORE_ENABLE=1 in the server's
 * `env` block to read from @sonisoft/sn-credstore instead.
 *
 * That option matters more here than anywhere else in the stack: an MCP server is
 * started by its client (Claude Code, an IDE) as a non-interactive child process,
 * which is precisely the session that cannot unlock the keyring. The SDK's
 * `KeyChain.getPassword()` swallows the failure and returns null, so every tool
 * call reports "no credentials" instead of a keyring error. If the client's
 * desktop session happens to have an unlocked keyring the default works fine —
 * which is why this is a choice rather than a default.
 *
 * Imported for its side effect by src/index.ts, before anything else.
 *
 * The import stays dynamic even though sn-credstore is a declared dependency,
 * because it must NOT run unless asked: importing
 * '@sonisoft/sn-credstore/register' installs the shim as a side effect, so a
 * static import would install it on every start regardless of the setting.
 */

/**
 * True when the operator asked for the credential store.
 *
 * There are no CLI flags here — an MCP server is configured through the `env`
 * block of its client's config — so this is env-only. SN_CRED_STORE_DISABLE wins
 * over everything, so one variable always switches it off.
 */
function credStoreRequested(): boolean {
  if (process.env.SN_CRED_STORE_DISABLE) return false;
  return Boolean(process.env.SN_CRED_STORE_ENABLE);
}

if (!credStoreRequested()) {
  if (process.env.SN_CRED_STORE_DEBUG) {
    process.stderr.write(
      "now-sdk-ext-mcp: credential store not requested — using the SDK keyring\n"
    );
  }
} else {
  try {
    await import("@sonisoft/sn-credstore/register");
  } catch (error) {
    // sn-credstore is a declared dependency now, so there is no "not installed"
    // case left to tolerate — a failure here is a real failure.
    //
    // Continuing would silently fall back to the keyring, and the SDK's next
    // credential write reseeds from a failed read, wiping every other alias.
    // Refusing to start is the safe outcome.
    //
    // stderr, never stdout: stdout is the JSON-RPC transport, and writing a
    // non-protocol byte to it breaks the client's parser.
    const message = error instanceof Error ? error.message : String(error);
    const remediation = (error as { remediation?: string })?.remediation;
    process.stderr.write(
      `now-sdk-ext-mcp: the credential store failed to initialise: ${message}\n` +
        (remediation ? `\nRemediation: ${remediation}\n` : "") +
        `\nTo start against the OS keyring instead, unset SN_CRED_STORE_ENABLE.\n`
    );
    process.exit(1);
  }
}

export {};
