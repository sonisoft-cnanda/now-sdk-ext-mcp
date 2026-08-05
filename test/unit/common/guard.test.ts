/**
 * The permission guard around tool registration.
 *
 * Two things are being pinned. First, that the classification derived from
 * TOOL_ANNOTATIONS is right — which it could not be before, because ARBITRARY was
 * literally `= OVERWRITE_ONCE` and the two were indistinguishable at runtime. Second,
 * that the guard cannot be avoided: it wraps `registerTool`, which is the call shape
 * every one of the 87 tools uses and which annotations.test.ts already regexes on.
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import { installPolicy, denyLayer, grantLayer, resetPolicyForTests } from "@sonisoft/now-sdk-ext-core";

import { annotationsFor, requirementFor } from "../../../src/common/annotations.js";
import { guardServer } from "../../../src/common/guard.js";

afterEach(() => resetPolicyForTests());

describe("requirement derivation", () => {
    it("treats read tools as needing nothing", () => {
        expect(requirementFor("query_table").verbs).toEqual([]);
    });

    it.each(["create_kb_article", "update_kb_article", "query_delete_records", "push_script"])(
        "treats %s as a write",
        (tool) => {
            expect(requirementFor(tool).verbs).toEqual(["write"]);
        },
    );

    it.each(["execute_script", "execute_flow", "test_flow"])(
        "treats %s as execute AND write",
        (tool) => {
            // Previously underivable: ARBITRARY was the same object as OVERWRITE_ONCE,
            // so nothing at runtime could tell "runs arbitrary logic" from "overwrites".
            expect(requirementFor(tool).verbs).toEqual(["execute", "write"]);
        },
    );

    it.each(["run_atf_test", "run_atf_test_suite"])(
        "treats %s as execute — a suite runs third-party logic that mutates",
        (tool) => {
            // Matches how the CLI classifies `nex atf`. The two surfaces disagreed
            // before: MCP called it OVERWRITE_ONCE, the CLI called it execute.
            expect(requirementFor(tool).verbs).toContain("execute");
        },
    );

    it("classifies pull_script as a LOCAL write, so it is not gated", () => {
        // It overwrites a file on disk and is read-only with respect to the instance.
        // Gating it as an instance write would be a false refusal.
        expect(requirementFor("pull_script").target).toBe("local");
    });

    it("throws for an unknown tool rather than defaulting permissive", () => {
        expect(() => requirementFor("no_such_tool")).toThrow(/No annotations defined/);
    });
});

describe("wire annotations", () => {
    it("does not leak verbs or target to the client", () => {
        // These are ours, not MCP's. The protocol shape must be unchanged by this feature.
        const wire = annotationsFor("execute_script") as Record<string, unknown>;
        expect(wire.verbs).toBeUndefined();
        expect(wire.target).toBeUndefined();
        expect(wire.readOnlyHint).toBe(false);
        expect(wire.destructiveHint).toBe(true);
    });

    it("still reports read-only tools as read-only", () => {
        expect(annotationsFor("query_table").readOnlyHint).toBe(true);
    });
});

/** Minimal stand-in for McpServer — the guard only touches registerTool. */
function fakeServer() {
    const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
    return {
        handlers,
        registerTool(name: string, _config: unknown, handler: (...a: unknown[]) => Promise<unknown>) {
            handlers.set(name, handler);
        },
        someOtherMethod() {
            return "passed through";
        },
    };
}

describe("guardServer", () => {
    it("passes non-registerTool members through untouched", () => {
        const server = fakeServer();
        const guarded = guardServer(server as never) as unknown as ReturnType<typeof fakeServer>;
        expect(guarded.someOtherMethod()).toBe("passed through");
    });

    it("refuses a write tool when policy denies, WITHOUT calling the handler", () => {
        installPolicy([denyLayer("test-deny", ["write"])]);
        const server = fakeServer();
        const guarded = guardServer(server as never);

        let called = false;
        (guarded as unknown as ReturnType<typeof fakeServer>).registerTool(
            "update_kb_article",
            {},
            async () => {
                called = true;
                return { content: [] };
            },
        );

        return server.handlers.get("update_kb_article")!().then((result) => {
            expect(called).toBe(false);
            expect((result as { isError?: boolean }).isError).toBe(true);
        });
    });

    it("RETURNS the refusal rather than throwing", async () => {
        // A throw becomes a protocol error the model cannot read; a result is something
        // it can act on.
        installPolicy([denyLayer("test-deny", ["write"])]);
        const server = fakeServer();
        const guarded = guardServer(server as never);
        (guarded as unknown as ReturnType<typeof fakeServer>).registerTool("update_kb_article", {}, async () => ({
            content: [],
        }));

        await expect(server.handlers.get("update_kb_article")!()).resolves.toBeDefined();
    });

    it("does not name an escape hatch in the refusal", async () => {
        // The caller is the model. A refusal advertising a parameter it could set just
        // produces a retry loop.
        installPolicy([denyLayer("test-deny", ["write"])]);
        const server = fakeServer();
        const guarded = guardServer(server as never);
        (guarded as unknown as ReturnType<typeof fakeServer>).registerTool("update_kb_article", {}, async () => ({
            content: [],
        }));

        const result = (await server.handlers.get("update_kb_article")!()) as {
            content: { text: string }[];
        };
        const text = result.content[0].text;
        expect(text).not.toMatch(/allow|parameter|set .* true/i);
        expect(text).toContain("nothing was changed");
    });

    it("lets read tools through even when everything is denied", async () => {
        installPolicy([denyLayer("test-deny", ["write", "execute"])]);
        const server = fakeServer();
        const guarded = guardServer(server as never);

        let called = false;
        (guarded as unknown as ReturnType<typeof fakeServer>).registerTool("query_table", {}, async () => {
            called = true;
            return { content: [{ text: "ok", type: "text" }] };
        });

        await server.handlers.get("query_table")!();
        expect(called).toBe(true);
    });

    it("permits writes under the default posture", async () => {
        installPolicy([grantLayer("default", ["write", "execute"])]);
        const server = fakeServer();
        const guarded = guardServer(server as never);

        let called = false;
        (guarded as unknown as ReturnType<typeof fakeServer>).registerTool("update_kb_article", {}, async () => {
            called = true;
            return { content: [] };
        });

        await server.handlers.get("update_kb_article")!();
        expect(called).toBe(true);
    });

    it("refuses to register an unclassified tool, at STARTUP", () => {
        // Fails when the server boots rather than on first call in front of a user.
        const server = fakeServer();
        const guarded = guardServer(server as never);
        expect(() =>
            (guarded as unknown as ReturnType<typeof fakeServer>).registerTool(
                "totally_new_tool",
                {},
                async () => ({ content: [] }),
            ),
        ).toThrow(/No annotations defined/);
    });
});
