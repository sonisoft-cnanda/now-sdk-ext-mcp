/**
 * Bridges core's `onProgress` callbacks to MCP `notifications/progress`.
 *
 * Long-running tools were silent until they returned, which is indistinguishable
 * from a hang for both the model and the user. Core already reports progress on
 * several operations — batch create/update, query update/delete, update-set clone,
 * complete-workflow creation — via an `onProgress?: (message: string) => void`
 * callback that the MCP layer simply discarded.
 *
 * Progress is only sent when the CLIENT asked for it by supplying a progressToken
 * in the request `_meta`. Per the MCP spec a server must not send progress
 * notifications unsolicited, and most callers do not want them.
 *
 * Core reports free-text messages with no notion of completion, so these are
 * INDETERMINATE notifications: `progress` increments per message and `total` is
 * left undefined. Inventing a percentage from a message count would be a lie that
 * gets less accurate the longer an operation runs.
 */

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Signature core expects. Matches BatchCreateOptions.onProgress and friends. */
export type ProgressCallback = (message: string) => void;

/**
 * Returns an `onProgress` callback to hand to core, or `undefined` when the client
 * did not request progress.
 *
 * `undefined` rather than a no-op is deliberate: core's options are optional, and
 * passing a callback that does nothing would still make core do the work of
 * building progress strings for nobody.
 */
export function progressReporter(extra: ToolExtra | undefined): ProgressCallback | undefined {
    const token = extra?._meta?.progressToken;
    if (token === undefined || token === null) {
        return undefined;
    }

    let sent = 0;
    return (message: string) => {
        sent += 1;
        // Fire-and-forget. A failed notification must never fail the operation that
        // was reporting progress — the work itself is what the caller asked for.
        void extra?.sendNotification({
            method: "notifications/progress",
            params: {
                progressToken: token,
                progress: sent,
                message,
            },
        }).catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            // stderr, never stdout: stdout is the JSON-RPC transport.
            console.error(`[progress] failed to send notification: ${detail}`);
        });
    };
}
