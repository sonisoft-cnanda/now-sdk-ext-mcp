/**
 * The guard against a REAL McpServer, driven through a real client.
 *
 * `guard.test.ts` exercises the logic against a hand-written `fakeServer()`, which is
 * fast but proves nothing about the part the whole feature rests on: that a Proxy over
 * a genuine `McpServer` is transparent. A fake cannot catch an SDK upgrade that adds an
 * accessor backed by a real `#private` field, because a plain object has no brand checks
 * to fail.
 *
 * Raised in review of #17, and it matches AGENTS.md rule 6 — assert through a real
 * Client/McpServer pair over InMemoryTransport, not by calling handlers directly.
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import { denyLayer, grantLayer, installPolicy, resetPolicyForTests } from "@sonisoft/now-sdk-ext-core";

import { guardServer } from "../../../src/common/guard.js";
import { annotationsFor } from "../../../src/common/annotations.js";
import { createTestClientServer } from "../../helpers/mcp-test-helpers.js";

afterEach(() => resetPolicyForTests());

/** Registers one real tool through the guard, on a real server. */
function withGuardedTool(toolName: string, onCall: () => void) {
    return (server: Parameters<typeof guardServer>[0]) => {
        const guarded = guardServer(server);
        guarded.registerTool(
            toolName,
            {
                annotations: annotationsFor(toolName),
                description: `test double for ${toolName}`,
                inputSchema: {},
            },
            () => {
                onCall();
                return { content: [{ text: "ran", type: "text" as const }] };
            },
        );
    };
}

describe("wrapping a real McpServer", () => {
    it("registers through the Proxy and the tool is visible to a real client", async () => {
        installPolicy([grantLayer("default", ["write", "execute"])]);
        let called = false;
        const { client, server } = await createTestClientServer(
            withGuardedTool("update_kb_article", () => {
                called = true;
            }),
        );

        try {
            // The Proxy must be transparent enough that registration lands on the real
            // server — `server.connect()` is called on the UN-proxied variable.
            const listed = await client.listTools();
            expect(listed.tools.map((t) => t.name)).toContain("update_kb_article");

            const result = await client.callTool({ arguments: {}, name: "update_kb_article" });
            expect(called).toBe(true);
            expect(result.isError).toBeFalsy();
        } finally {
            await client.close();
            await server.close();
        }
    }, 30_000);

    it("refuses a denied write end to end, and the handler never runs", async () => {
        installPolicy([denyLayer("test-deny", ["write"])]);
        let called = false;
        const { client, server } = await createTestClientServer(
            withGuardedTool("update_kb_article", () => {
                called = true;
            }),
        );

        try {
            const result = await client.callTool({ arguments: {}, name: "update_kb_article" });
            expect(called).toBe(false);
            expect(result.isError).toBe(true);

            // Returned as a result the model can read, not thrown as a protocol error.
            const text = (result.content as { text: string }[])[0].text;
            expect(text).toContain("nothing was changed");
        } finally {
            await client.close();
            await server.close();
        }
    }, 30_000);

    it("leaves annotations on the wire untouched by the guard", async () => {
        installPolicy([grantLayer("default", ["write", "execute"])]);
        const { client, server } = await createTestClientServer(
            withGuardedTool("execute_script", () => undefined),
        );

        try {
            const listed = await client.listTools();
            const tool = listed.tools.find((t) => t.name === "execute_script");

            expect(tool?.annotations?.destructiveHint).toBe(true);
            // `verbs` and `target` are ours, not MCP's — they must not reach a client.
            expect((tool?.annotations as Record<string, unknown> | undefined)?.verbs).toBeUndefined();
            expect((tool?.annotations as Record<string, unknown> | undefined)?.target).toBeUndefined();
        } finally {
            await client.close();
            await server.close();
        }
    }, 30_000);

    it("still permits a read tool while every verb is denied", async () => {
        installPolicy([denyLayer("test-deny", ["write", "execute"])]);
        let called = false;
        const { client, server } = await createTestClientServer(
            withGuardedTool("query_table", () => {
                called = true;
            }),
        );

        try {
            const result = await client.callTool({ arguments: {}, name: "query_table" });
            expect(called).toBe(true);
            expect(result.isError).toBeFalsy();
        } finally {
            await client.close();
            await server.close();
        }
    }, 30_000);
});
