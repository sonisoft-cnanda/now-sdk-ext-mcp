import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    allowFromEnvironment,
    checkRequirement,
    denyFromEnvironment,
    grantLayer,
    installPolicy,
    setRemediationWriter,
    type PolicyLayer,
    type Verb,
} from "@sonisoft/now-sdk-ext-core";

import { requirementFor } from "./annotations.js";
import { getLogger } from "./logging.js";

/**
 * Permission enforcement for tool calls.
 *
 * Changes are PERMITTED by default, matching the CLI. Configuration is environment-only
 * because an MCP server does not control its own argv — whoever launches it sets
 * `NEX_POLICY_DENY`, and that is the layer the model cannot reach.
 *
 * There is deliberately NO per-tool "allow" parameter. On this surface the caller IS
 * the model, so a parameter it can set is not a control — and with a permissive default
 * it would grant nothing it did not already have. The same reasoning that kept
 * `--allow-write` off the CLI.
 */

const log = getLogger("policy");

/** Installs the ladder for this server process. Call once, at startup. */
export function initPolicy(): void {
    const layers: PolicyLayer[] = [];

    // 0. Operator lockdown, and the only rung the model cannot reach.
    //
    //    The guarantee has a precise limit worth stating: it holds only when set
    //    somewhere the model cannot write. An MCP server is launched from a config file
    //    — often .mcp.json inside the workspace — and an agent with file-write access
    //    can edit that. Set it in a shell profile, systemd unit, or container env.
    const envDeny = denyFromEnvironment(process.env, (m) => log.warn(m));
    if (envDeny) layers.push(envDeny);

    // 1. Grants from the environment. Inert while the default is permissive; kept so
    //    the ladder does not need rebuilding if the default ever flips.
    const envAllow = allowFromEnvironment(process.env, (m) => log.warn(m));
    if (envAllow) layers.push(envAllow);

    // 2. THE DEFAULT. Delete this layer to make the server deny-by-default.
    layers.push(grantLayer("default (changes permitted)", ["write", "execute"]));

    installPolicy(layers);
    setRemediationWriter((_verbs, missing, layer) => {
        const what = missing === "execute" ? "Running scripts or flows" : "Changing instance data";
        return `${what} is not permitted in this session (${layer}).`;
    });

    if (envDeny) {
        log.info("Instance changes are restricted by the environment", { layer: envDeny.name });
    }
}

/** Shape of what registerTool receives, narrowed to what the guard touches. */
type RegisterTool = (name: string, config: unknown, handler: ToolHandler) => unknown;
type ToolHandler = (...args: unknown[]) => Promise<ToolResult>;
interface ToolResult {
    content?: unknown[];
    isError?: boolean;
}

function refusalResult(toolName: string, verbs: readonly Verb[], layer: string): ToolResult {
    const what = verbs.includes("execute")
        ? "run scripts, flows or tests"
        : "change instance data";
    return {
        content: [
            {
                type: "text" as const,
                // States the situation without naming an escape hatch. There is nothing
                // the model can pass to get past this, and implying otherwise would just
                // produce a retry loop.
                text:
                    `Refused: this session is not permitted to ${what}.\n\n` +
                    `The tool "${toolName}" was not called and nothing was changed. ` +
                    `This restriction is set in the server's environment (${layer}) and ` +
                    `cannot be changed from a tool call. Read-only tools are unaffected.`,
            },
        ],
        isError: true,
    };
}

/**
 * Wraps a server so every tool registered through it is permission-checked.
 *
 * A Proxy over `registerTool` rather than a change to `ToolRegistrar`. That signature is
 * `(server) => void` across all 87 registrations, and `registry.test.ts` calls each
 * registrar with a bare `{registerTool}` fake — changing it would mean 87 edits and a
 * broken test for no benefit. Wrapping the server leaves both untouched, and because
 * `annotations.test.ts` already regexes on the exact `server.registerTool(` call shape,
 * a new tool cannot be added in a way that avoids this.
 *
 * Refusals are RETURNED as `isError` results, never thrown: a throw becomes a protocol
 * error, while a result is something the model can read and act on.
 */
export function guardServer(server: McpServer): McpServer {
    return new Proxy(server, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver) as unknown;
            if (property !== "registerTool" || typeof value !== "function") {
                return typeof value === "function" ? value.bind(target) : value;
            }

            const original = value as RegisterTool;
            return function registerToolGuarded(name: string, config: unknown, handler: ToolHandler) {
                // Throws for an unclassified tool, at REGISTRATION time — so a tool
                // without a permission classification cannot start the server, rather
                // than failing on first call in front of a user.
                const requirement = requirementFor(name);

                const guarded: ToolHandler = async (...args: unknown[]) => {
                    const decision = checkRequirement(requirement);
                    if (!decision.allowed) {
                        log.warn("Refused a tool call", {
                            tool: name,
                            verbs: decision.verbs,
                            decidingLayer: decision.decidingLayer,
                        });
                        return refusalResult(name, decision.verbs, decision.decidingLayer);
                    }

                    // Logged so a session's mutations are reconstructable afterwards.
                    // Reads are not logged — they are the overwhelming majority and
                    // would drown the signal.
                    if (requirement.verbs.length > 0 && requirement.target === "instance") {
                        log.info("Permitted a change", {
                            tool: name,
                            verbs: requirement.verbs,
                            grantedBy: decision.decidingLayer,
                        });
                    }

                    return handler(...args);
                };

                return original.call(target, name, config, guarded);
            };
        },
    });
}
