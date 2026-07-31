import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_PACKAGES } from "../config/tool-packages.js";
import { resolveToolPackage, ResolvedPackage } from "../common/tool-packages.js";
import { allToolNames } from "./registry.js";
import { annotationsFor } from "../common/annotations.js";

/**
 * `list_tool_packages` — what is loaded, and what else could be.
 *
 * Registered regardless of the active package, deliberately. If a filtered
 * session could not see this, a model working with a reduced surface would have
 * no way to tell whether a tool is genuinely absent from the server or merely
 * filtered out of this session — and would report "that capability does not
 * exist" when the truth is "ask your administrator for a different package".
 */
export function registerListToolPackagesTool(server: McpServer, active: ResolvedPackage): void {
    server.registerTool(
        "list_tool_packages",
        {
            annotations: annotationsFor("list_tool_packages"),
            title: "List Tool Packages",
            description:
                "Show which tool package this session is running and what other packages exist. " +
                "Use this when a capability you expected is missing: the tool may exist on the " +
                "server but be filtered out of this session, in which case the answer is a " +
                "different MCP_TOOL_PACKAGE rather than a missing feature.",
            inputSchema: {},
        },
        () => {
            const total = allToolNames().length;
            const lines: string[] = [];

            lines.push("=== Active ===");
            lines.push(`Package(s): ${active.names.join(", ")}`);
            lines.push(`Tools:      ${active.tools.length} of ${total}`);
            if (active.fellBack) {
                lines.push(
                    `NOTE: the requested package was not recognised, so "full" was substituted.`,
                );
            }
            if (active.unknownPackages.length > 0) {
                lines.push(`Unrecognised request(s): ${active.unknownPackages.join(", ")}`);
            }

            lines.push("");
            lines.push("=== Available ===");
            for (const [name, pkg] of Object.entries(TOOL_PACKAGES).sort(([a], [b]) => a.localeCompare(b))) {
                // Resolve each so the count reflects what would actually register,
                // not how many names the config happens to list.
                const resolved = resolveToolPackage(name);
                const marker = active.names.includes(name) ? " (active)" : "";
                lines.push(`${name}${marker} — ${resolved.tools.length} tools`);
                lines.push(`   ${pkg.description}`);
            }

            lines.push("");
            lines.push("Set MCP_TOOL_PACKAGE to change this. Comma-separated names are unioned.");

            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        },
    );
}
