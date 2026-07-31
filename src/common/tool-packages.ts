/**
 * Resolves MCP_TOOL_PACKAGE into the set of tools to register.
 *
 * Every failure mode here degrades toward MORE tools, never fewer. A typo in the
 * env var that silently exposed a smaller surface would look like the server was
 * broken — tools simply missing, with no error to search for. Falling back to
 * `full` and saying so on stderr is the recoverable direction.
 */

import { TOOL_PACKAGES, DEFAULT_PACKAGE } from "../config/tool-packages.js";
import { TOOL_ANNOTATIONS } from "./annotations.js";
import { allToolNames } from "../tools/registry.js";

/** Sentinel in a package's `tools` meaning "everything". */
const ALL = "*";

/** Sentinel meaning "every tool annotated readOnlyHint: true". */
const READONLY = "@readonly";

export interface ResolvedPackage {
    /** Package names that were actually applied. */
    names: string[];
    /** Tool names to register, already filtered to ones that exist. */
    tools: string[];
    /** Requested names that matched no package. */
    unknownPackages: string[];
    /** Tools named by a package that this server does not have. */
    unknownTools: string[];
    /** True when the requested selection could not be used and `full` was substituted. */
    fellBack: boolean;
}

/**
 * Tools annotated as read-only. Derived, so it cannot drift from the annotations.
 *
 * Filtered to the registry deliberately. TOOL_ANNOTATIONS covers one tool the
 * registry does not — `list_tool_packages`, which is registered unconditionally —
 * and returning it here would put a name in the resolved set that has no
 * registrar, crashing startup on `TOOL_REGISTRY[name](server)`.
 */
function readonlyTools(known: Set<string>): string[] {
    return Object.entries(TOOL_ANNOTATIONS)
        .filter(([name, a]) => a.readOnlyHint === true && known.has(name))
        .map(([name]) => name);
}

/**
 * Resolves a selection into a concrete tool set.
 *
 * `selection` is the raw env value: one package name, or several comma-separated,
 * in which case the result is their UNION. Union rather than intersection because
 * combining packages is how someone expresses "I do service desk work AND change
 * approvals" — an intersection of two role packages is almost always empty.
 */
export function resolveToolPackage(selection: string | undefined): ResolvedPackage {
    const known = new Set(allToolNames());
    const requested = (selection ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    if (requested.length === 0) {
        return {
            names: [DEFAULT_PACKAGE],
            tools: allToolNames(),
            unknownPackages: [],
            unknownTools: [],
            fellBack: false,
        };
    }

    const names: string[] = [];
    const unknownPackages: string[] = [];
    const selected = new Set<string>();
    const namedButMissing = new Set<string>();

    for (const name of requested) {
        // hasOwnProperty, not bracket access. TOOL_PACKAGES is an object literal,
        // so TOOL_PACKAGES["constructor"] returns the Object constructor — truthy,
        // with no `.tools` — and `for (const t of pkg.tools)` then throws at module
        // load, before the uncaughtException handler exists. MCP_TOOL_PACKAGE=
        // constructor would crash the server rather than falling back, which is the
        // exact opposite of this file's stated invariant.
        const pkg = Object.prototype.hasOwnProperty.call(TOOL_PACKAGES, name)
            ? TOOL_PACKAGES[name]
            : undefined;
        if (!pkg) {
            unknownPackages.push(name);
            continue;
        }
        names.push(name);
        for (const tool of pkg.tools) {
            if (tool === ALL) {
                allToolNames().forEach((t) => selected.add(t));
            } else if (tool === READONLY) {
                readonlyTools(known).forEach((t) => selected.add(t));
            } else if (known.has(tool)) {
                selected.add(tool);
            } else {
                // Expected for packages naming tools from open tickets; still
                // reported, because the same path catches a genuine typo.
                namedButMissing.add(tool);
            }
        }
    }

    // Nothing usable was requested. Fall back rather than register an empty
    // server: a server with no tools is indistinguishable from a broken one.
    if (names.length === 0) {
        return {
            names: [DEFAULT_PACKAGE],
            tools: allToolNames(),
            unknownPackages,
            unknownTools: [],
            fellBack: true,
        };
    }

    return {
        names,
        tools: [...selected].sort(),
        unknownPackages,
        unknownTools: [...namedButMissing].sort(),
        fellBack: false,
    };
}

/**
 * Reports the resolution on stderr.
 *
 * stderr, never stdout — stdout is the JSON-RPC transport, and a stray byte
 * there breaks the client's parser.
 */
export function reportResolution(resolved: ResolvedPackage): void {
    const { names, tools, unknownPackages, unknownTools, fellBack } = resolved;

    if (unknownPackages.length > 0) {
        const available = Object.keys(TOOL_PACKAGES).sort().join(", ");
        console.error(
            `[tool-packages] unknown package(s): ${unknownPackages.join(", ")}. ` +
                `Available: ${available}.` +
                (fellBack ? ` Falling back to "${DEFAULT_PACKAGE}".` : ""),
        );
    }

    if (unknownTools.length > 0) {
        console.error(
            `[tool-packages] ${unknownTools.length} tool(s) named by a package do not exist ` +
                `on this server and were skipped: ${unknownTools.join(", ")}. ` +
                `This is expected for tools from work that has not landed yet.`,
        );
    }

    console.error(
        `[tool-packages] active: ${names.join(", ")} — ${tools.length} of ${allToolNames().length} tools registered`,
    );
}
