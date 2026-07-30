import { createRequire } from "node:module";

/**
 * The version this server reports to clients during the initialize handshake.
 *
 * Read from package.json rather than hard-coded. The literal previously here had
 * drifted to "1.0.0-alpha.0" while the package was on 4.x, so every client was
 * told the wrong version of the server it was talking to — and semantic-release,
 * which owns the real version, had no way to correct it.
 *
 * Extracted from index.ts so it is reachable from a test. index.ts constructs and
 * connects a server as a side effect of import, so it cannot be imported to
 * assert on; without this seam the only coverage was a manual handshake probe.
 */
export function readServerVersion(): string {
    const pkg = createRequire(import.meta.url)("../../package.json") as { version?: string };
    if (typeof pkg.version !== "string" || pkg.version.length === 0) {
        // Better to be obviously wrong than quietly wrong: a client that sees
        // "0.0.0-unknown" can be diagnosed, one that sees a plausible stale
        // number cannot.
        return "0.0.0-unknown";
    }
    return pkg.version;
}
