/**
 * The contract this server depends on when it logs `{ error }`.
 *
 * `connection.ts`, `progress.ts` and `index.ts` all pass a raw `Error` as a metadata
 * value instead of interpolating it into the message. That is what lets core's
 * redaction see it — but `Error.prototype.message` and `.stack` are NON-ENUMERABLE, so
 * a naive `JSON.stringify` of a nested `{ error }` yields `{}`. If core did not unwrap
 * Errors explicitly, moving off `console.error` would have made failures vanish from
 * the logs entirely, which is worse than the interpolation it replaced.
 *
 * Core owns and tests the redaction itself. What is pinned here is the part this repo
 * relies on and states in its README: that the detail survives AND the credential does
 * not. Uses the real core logger, not the mock, or it would assert nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Error passed as log metadata", () => {
    let tmp: string;
    let logFile: string;
    let contents: string;
    const savedXdg = process.env.XDG_STATE_HOME;

    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nex-mcp-errmeta-"));
        process.env.XDG_STATE_HOME = tmp;

        const { Logger, configureLogging, flushLogs } = await import(
            "@sonisoft/now-sdk-ext-core"
        );
        configureLogging({ console: false, file: true, level: "debug" });

        // Exactly the shape connection.ts logs on the retry path.
        const err = new Error("UPSTREAM_FAILURE_DETAIL") as Error & {
            config?: unknown;
        };
        err.config = { auth: { password: "SENTINEL_PASSWORD" } };
        new Logger("probe").warn("Retryable error, refreshing session and retrying", {
            error: err,
        });

        await flushLogs();
        logFile = path.join(tmp, "now-sdk-ext", "logs", "nex.log");
        contents = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    });

    afterAll(async () => {
        const { resetLoggingForTests } = await import("@sonisoft/now-sdk-ext-core");
        resetLoggingForTests();
        if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
        else process.env.XDG_STATE_HOME = savedXdg;
        fs.rmSync(tmp, { force: true, recursive: true });
    });

    it("keeps the error message — a serialized {} would be worse than not logging", () => {
        expect(contents).toContain("UPSTREAM_FAILURE_DETAIL");
    });

    it("keeps the stack, which is the point of logging the error at all", () => {
        expect(contents).toMatch(/"stack":"Error: UPSTREAM_FAILURE_DETAIL/);
    });

    it("redacts credential material hanging off the error", () => {
        expect(contents).not.toContain("SENTINEL_PASSWORD");
        expect(contents).toContain("[redacted]");
    });
});
