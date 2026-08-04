/**
 * NEX-3, end to end for the MCP server.
 *
 * This process is the reason file logging had to become opt-in. Its working directory
 * is chosen by whoever launched it — a desktop client, a container, an agent harness —
 * and core used to create ./logs/ there on import, without this server ever asking to
 * log anything.
 *
 * The second invariant is older and sharper: stdout carries JSON-RPC. One stray byte
 * desynchronises the client's parser for the whole session, and it fails as "the MCP
 * server is broken" rather than as a logging bug. Only running the real server proves
 * either, so this drives dist/index.js over a real stdio handshake.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = process.cwd();
const SERVER = path.join(REPO, "dist", "index.js");
const BUILT = fs.existsSync(SERVER);

const HANDSHAKE = [
    JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
            capabilities: {},
            clientInfo: { name: "nex3-test", version: "1" },
            protocolVersion: "2024-11-05",
        },
    }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }),
].join("\n");

interface RunResult {
    stdout: string;
    stderr: string;
}

/** Boots the server, completes a handshake, and returns what each stream received. */
function runServer(cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        // Jest sets NODE_ENV/JEST_* and children pick up tooling behaviour from them.
        const childEnv = { ...process.env, ...env };
        delete childEnv.NODE_ENV;
        for (const key of Object.keys(childEnv)) {
            if (key.startsWith("JEST_")) delete childEnv[key];
        }

        const child = spawn(process.execPath, [SERVER], { cwd, env: childEnv });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("error", reject);
        child.on("close", () => resolve({ stderr, stdout }));

        child.stdin.write(`${HANDSHAKE}\n`);
        child.stdin.end();

        const timer = setTimeout(() => child.kill("SIGKILL"), 40_000);
        child.on("close", () => clearTimeout(timer));
    });
}

// `npm run test:unit` does not build; skip rather than fail misleadingly.
const maybe = BUILT ? describe : describe.skip;

maybe("MCP server logging", () => {
    let workdir: string;
    let stateHome: string;

    beforeAll(() => {
        workdir = fs.mkdtempSync(path.join(os.tmpdir(), "nex-mcp-"));
        stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "nex-mcp-state-"));
    });

    afterAll(() => {
        fs.rmSync(workdir, { force: true, recursive: true });
        fs.rmSync(stateHome, { force: true, recursive: true });
    });

    it("writes nothing but JSON-RPC to stdout", async () => {
        const { stdout } = await runServer(workdir, { XDG_STATE_HOME: stateHome });

        const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            const parsed = JSON.parse(line) as { jsonrpc?: string };
            expect(parsed.jsonrpc).toBe("2.0");
        }
    }, 60_000);

    it("creates no logs/ directory in the directory it was launched from", async () => {
        await runServer(workdir, { XDG_STATE_HOME: stateHome });

        expect(fs.existsSync(path.join(workdir, "logs"))).toBe(false);
    }, 60_000);

    it("still reports startup breadcrumbs on stderr", async () => {
        const { stderr } = await runServer(workdir, { XDG_STATE_HOME: stateHome });

        // These say which tool package loaded and that the transport came up. Demoting
        // them below the default console level would leave an operator with nothing.
        expect(stderr).toContain("tools registered");
        expect(stderr).toContain("running on stdio");
    }, 60_000);

    it("writes a log file only when asked, and never into the cwd", async () => {
        const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "nex-mcp-optin-"));
        try {
            await runServer(workdir, {
                NEX_LOG_FILE: "1",
                NEX_LOG_LEVEL: "debug",
                XDG_STATE_HOME: stateDir,
            });

            const logFile = path.join(stateDir, "now-sdk-ext", "logs", "nex.log");
            expect(fs.existsSync(logFile)).toBe(true);
            expect(fs.existsSync(path.join(workdir, "logs"))).toBe(false);
        } finally {
            fs.rmSync(stateDir, { force: true, recursive: true });
        }
    }, 60_000);

    it("lets NEX_LOG_FILE=0 override NEX_LOG_DIR", async () => {
        const refused = path.join(workdir, "refused-logs");
        await runServer(workdir, {
            NEX_LOG_DIR: refused,
            NEX_LOG_FILE: "0",
            XDG_STATE_HOME: stateHome,
        });

        expect(fs.existsSync(refused)).toBe(false);
    }, 60_000);
});
