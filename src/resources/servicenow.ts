/**
 * Read-only MCP resources over `servicenow://` URIs.
 *
 * Resources are for stable, addressable reference data a client may want to
 * attach directly — table schemas, the current scope, the alias list. Tools stay
 * for actions. Before this, every one of those required a tool call, which costs
 * a round trip and puts transient reference data into the conversation as tool
 * output.
 *
 * TWO RULES SHAPE EVERYTHING HERE:
 *
 * 1. Each resource is backed by the SAME core manager as its equivalent tool,
 *    and goes through `withConnectionRetry` exactly as tools do. A parallel
 *    fetch path is how you end up with a resource that returns nothing for
 *    users of the recommended credential setup while the tool beside it works.
 *
 * 2. The alias is part of the URI, not an implicit default. Tools take an
 *    optional `instance` argument; a resource has only its URI, so the instance
 *    has to be addressable — `servicenow://dev/schema/incident` is a different
 *    resource from `servicenow://prod/schema/incident`, and conflating them
 *    would be the cross-instance confusion the core guard exists to prevent.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScopeManager, UpdateSetManager, SchemaDiscovery } from "@sonisoft/now-sdk-ext-core";
import { listAliases } from "@sonisoft/sn-credstore";
import { withConnectionRetry } from "../common/connection.js";

/** Set by sn-credstore's shim when it has taken over credential storage. */
const PATCHED_ENV_VAR = "NOW_SDK_KEYCHAIN_PATCHED";

/**
 * Projects an alias onto exactly the fields intended for publication.
 *
 * `listAliases` is documented as returning metadata only, and today it does.
 * This does not rely on that. It is a positive allowlist rather than a filter,
 * so a field added upstream is omitted by default instead of published by
 * default — and this is the single most attachable resource in the server, the
 * one most likely to be pasted wholesale into a conversation.
 */
function publicAliasFields(alias: {
    alias: string;
    isDefault: boolean;
    type: string;
    instanceUrl: string;
    username?: string;
}): Record<string, unknown> {
    return {
        alias: alias.alias,
        isDefault: alias.isDefault,
        type: alias.type,
        instanceUrl: alias.instanceUrl,
        ...(alias.username === undefined ? {} : { username: alias.username }),
    };
}

function json(uri: string, body: unknown) {
    return {
        contents: [
            {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(body, null, 2),
            },
        ],
    };
}

/**
 * `servicenow://instances` — which instances this server can serve.
 *
 * Deliberately reports WHICH STORE it read. When the sn-credstore shim is not
 * active the SDK's OS keyring is authoritative, and that cannot be enumerated —
 * so the alias list is reported as unavailable rather than as empty. An empty
 * list would read as "no credentials configured", which is precisely the
 * ambiguity sn-credstore exists to remove.
 *
 * Contains no secret material: `listAliases` returns metadata only.
 */
function registerInstancesResource(server: McpServer): void {
    server.registerResource(
        "instances",
        "servicenow://instances",
        {
            title: "Configured ServiceNow instances",
            description:
                "Aliases this server can connect to, the alias used when a tool omits one, " +
                "and which credential store those aliases were read from. Contains no secrets.",
            mimeType: "application/json",
        },
        async (uri) => {
            const shimActive = process.env[PATCHED_ENV_VAR] === "1";
            const defaultAlias = process.env.SN_AUTH_ALIAS ?? null;

            if (!shimActive) {
                return json(uri.href, {
                    defaultAlias,
                    credentialStore: "os-keyring",
                    aliases: null,
                    note:
                        "The sn-credstore shim is not active, so credentials come from the OS " +
                        "keyring, which cannot be enumerated. This is not the same as having no " +
                        "credentials. Set SN_CRED_STORE_ENABLE=1 to read from sn-credstore instead.",
                });
            }

            try {
                const summary = await listAliases();
                return json(uri.href, {
                    defaultAlias,
                    credentialStore: "sn-credstore",
                    aliases: summary.aliases.map(publicAliasFields),
                });
            } catch (error) {
                // A store that cannot be read is a finding to report, not an
                // empty list to hand back.
                const message = error instanceof Error ? error.message : String(error);
                return json(uri.href, {
                    defaultAlias,
                    credentialStore: "sn-credstore",
                    aliases: null,
                    error: message,
                    remediation: (error as { remediation?: string })?.remediation,
                });
            }
        },
    );
}

/**
 * Registers one alias-scoped resource template.
 *
 * `list` is explicitly `undefined` rather than omitted: the SDK requires the key
 * so that forgetting to enumerate is a decision rather than an oversight. These
 * cannot be enumerated anyway — listing every table on an instance would be a
 * very expensive `resources/list`.
 */
function registerAliasScopedResource(
    server: McpServer,
    name: string,
    uriTemplate: string,
    title: string,
    description: string,
    read: (alias: string, vars: Record<string, string>) => Promise<unknown>,
): void {
    server.registerResource(
        name,
        new ResourceTemplate(uriTemplate, { list: undefined }),
        { title, description, mimeType: "application/json" },
        async (uri, vars) => {
            // UriTemplate yields string | string[] per variable; these templates
            // only ever declare single-valued segments.
            const flat: Record<string, string> = {};
            for (const [k, v] of Object.entries(vars)) {
                flat[k] = Array.isArray(v) ? v[0] : v;
            }
            const alias = flat.alias;
            return json(uri.href, await read(alias, flat));
        },
    );
}

export function registerServiceNowResources(server: McpServer): void {
    registerInstancesResource(server);

    registerAliasScopedResource(
        server,
        "current-scope",
        "servicenow://{alias}/scope/current",
        "Current application scope",
        "The application scope currently selected on the instance, as get_current_scope reports it.",
        async (alias) =>
            withConnectionRetry(alias, async (snInstance) =>
                new ScopeManager(snInstance).getCurrentApplication(),
            ),
    );

    registerAliasScopedResource(
        server,
        "current-update-set",
        "servicenow://{alias}/update-set/current",
        "Current update set",
        "The update set currently capturing changes, as get_current_update_set reports it.",
        async (alias) =>
            withConnectionRetry(alias, async (snInstance) =>
                new UpdateSetManager(snInstance).getCurrentUpdateSet(),
            ),
    );

    registerAliasScopedResource(
        server,
        "table-schema",
        "servicenow://{alias}/schema/{table}",
        "Table schema",
        "Fields, types and references for a table. Mirrors discover_table_schema with its " +
            "optional sections off, so this stays cheap enough to attach as context.",
        async (alias, vars) =>
            withConnectionRetry(alias, async (snInstance) =>
                new SchemaDiscovery(snInstance).discoverTableSchema(vars.table, {
                    // The expensive sections are opt-in on the tool for good reason;
                    // a resource is attached rather than deliberately invoked, so it
                    // should not silently pull choices and business rules too.
                    includeChoiceTables: false,
                    includeRelationships: false,
                    includeUIPolicies: false,
                    includeBusinessRules: false,
                }),
            ),
    );
}
