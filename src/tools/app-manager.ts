import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ApplicationManager,
  APP_TAB_CONTEXT,
  CompanyApplications,
  AppRepoApplication,
  BatchDefinition,
  BatchInstallation,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the get_app_details tool on the MCP server.
 *
 * Gets detailed information about a ServiceNow application by its sys_id.
 */
export function registerGetAppDetailsTool(server: McpServer): void {
  server.registerTool(
    "get_app_details",
    {
      title: "Get Application Details",
      description:
        "Get detailed information about a ServiceNow application by its sys_id. " +
        "Returns version, install status, update availability, scope, vendor, " +
        "dependencies, store link, and other metadata.\n\n" +
        "Use `lookup_app` to find an application's sys_id by name, then use " +
        "this tool to get full details.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        app_id: z
          .string()
          .describe("The sys_id of the application to get details for."),
      },
    },
    async ({ instance, app_id }) => {
      try {
        const details = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new ApplicationManager(snInstance);
            return await mgr.getApplicationDetails(app_id);
          }
        );

        if (!details) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Application '${app_id}' not found or not available on this instance.`,
              },
            ],
          };
        }

        const lines: string[] = [];
        lines.push("=== Application Details ===");
        lines.push(`Name: ${details.name}`);
        lines.push(`sys_id: ${details.sys_id}`);
        lines.push(`Scope: ${details.scope}`);
        lines.push(`Version: ${details.version}`);
        if (details.latest_version)
          lines.push(`Latest Version: ${details.latest_version}`);
        lines.push(`Installed: ${details.isInstalled}`);
        lines.push(`Update Available: ${details.isInstalledAndUpdateAvailable}`);
        if (details.vendor) lines.push(`Vendor: ${details.vendor}`);
        if (details.short_description)
          lines.push(`Description: ${details.short_description}`);
        if (details.install_date)
          lines.push(`Install Date: ${details.install_date}`);
        if (details.update_date)
          lines.push(`Update Date: ${details.update_date}`);
        lines.push(`Active: ${details.active}`);
        lines.push(`Is Store App: ${details.is_store_app}`);
        if (details.store_link)
          lines.push(`Store Link: ${details.store_link}`);
        lines.push(`Can Install/Upgrade: ${details.can_install_or_upgrade}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting application details: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the validate_app_install tool on the MCP server.
 *
 * Validates whether a set of applications are installed at expected versions.
 */
export function registerValidateAppInstallTool(server: McpServer): void {
  server.registerTool(
    "validate_app_install",
    {
      title: "Validate Application Installation",
      description:
        "Validate whether a set of applications are installed at the expected versions. " +
        "Reports which apps are valid, need installation, need upgrade, or have " +
        "version mismatches.\n\n" +
        "Useful for verifying environment readiness or checking deployment prerequisites.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        packages: z
          .array(
            z.object({
              id: z.string().describe("Application sys_id"),
              requested_version: z
                .string()
                .describe("Expected version (e.g., '1.2.3')"),
              type: z
                .string()
                .optional()
                .describe("Package type (optional)"),
              load_demo_data: z
                .boolean()
                .optional()
                .describe("Whether to load demo data (optional)"),
            })
          )
          .describe("List of applications to validate."),
      },
    },
    async ({ instance, packages }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new ApplicationManager(snInstance);
            const defs = packages.map(
              (p) =>
                new BatchDefinition(
                  p.id,
                  p.load_demo_data ?? false,
                  "",
                  "",
                  p.requested_version,
                  p.type ?? ""
                )
            );
            const batch = new BatchInstallation();
            batch.packages = defs;
            return await mgr.validateBatchInstallation(batch);
          }
        );

        const lines: string[] = [];
        lines.push("=== Application Validation Results ===");
        lines.push(`Overall Valid: ${result.isValid}`);
        lines.push(`Total: ${result.totalApplications}`);
        lines.push(`Already Valid: ${result.alreadyValid}`);
        lines.push(`Needs Installation: ${result.needsInstallation}`);
        lines.push(`Needs Upgrade: ${result.needsUpgrade}`);
        lines.push(`Errors: ${result.errors}`);

        lines.push("");
        for (const app of result.applications) {
          lines.push(`--- ${app.name || app.id} ---`);
          lines.push(`  Status: ${app.validationStatus}`);
          lines.push(`  Requested: ${app.requested_version}`);
          if (app.installed_version)
            lines.push(`  Installed: ${app.installed_version}`);
          lines.push(`  Installed: ${app.isInstalled}`);
          lines.push(`  Version Match: ${app.isVersionMatch}`);
          lines.push(`  Needs Action: ${app.needsAction}`);
          if (app.error) lines.push(`  Error: ${app.error}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error validating applications: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/** Formats elapsed time from a start timestamp. */
function formatDuration(startMs: number): string {
  const elapsed = Date.now() - startMs;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rem}s` : `${seconds}s`;
}

/**
 * Registers the search_store_apps tool on the MCP server.
 *
 * Search/browse ServiceNow store applications by category.
 */
export function registerSearchStoreAppsTool(server: McpServer): void {
  server.registerTool(
    "search_store_apps",
    {
      title: "Search Store Applications",
      description:
        "Search or browse ServiceNow store applications by category.\n\n" +
        "Tab contexts:\n" +
        '- "installed" — list all installed store applications\n' +
        '- "updates" — list installed apps that have updates available\n' +
        '- "available_for_you" — browse apps available for installation\n\n' +
        "Use this to discover what is installed, find available updates, " +
        "or browse for new applications to install.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        tab_context: z
          .enum(["installed", "updates", "available_for_you"])
          .describe(
            'Category to list: "installed" for installed apps, ' +
              '"updates" for apps with available updates, ' +
              '"available_for_you" for apps available to install.'
          ),
        search_key: z
          .string()
          .optional()
          .describe("Optional keyword to filter results by name."),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe("Maximum number of results to return. Default 50."),
      },
    },
    async ({ instance, tab_context, search_key, limit }) => {
      try {
        const apps = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new ApplicationManager(snInstance);
            return await mgr.searchApplications({
              tabContext: tab_context as APP_TAB_CONTEXT,
              searchKey: search_key,
              limit,
            });
          }
        );

        const lines: string[] = [];
        lines.push(`=== Store Applications (${tab_context}) ===`);
        if (search_key) lines.push(`Search: "${search_key}"`);
        lines.push(`Found: ${apps.length} application(s)`);

        for (let i = 0; i < apps.length; i++) {
          const app = apps[i];
          lines.push("");
          lines.push(`${i + 1}. ${app.name}`);
          lines.push(`   sys_id: ${app.sys_id}`);
          if (app.scope) lines.push(`   Scope: ${app.scope}`);
          lines.push(`   Version: ${app.version}`);
          if (app.latest_version)
            lines.push(`   Latest Version: ${app.latest_version}`);
          lines.push(`   Installed: ${app.isInstalled}`);
          if (app.isInstalledAndUpdateAvailable)
            lines.push(`   Update Available: true`);
          if (app.vendor) lines.push(`   Vendor: ${app.vendor}`);
          if (app.short_description) {
            const desc =
              app.short_description.length > 120
                ? app.short_description.slice(0, 120) + "..."
                : app.short_description;
            lines.push(`   Description: ${desc}`);
          }
        }

        lines.push("");
        lines.push(
          "Tip: Use get_app_details with a sys_id for full details. " +
            "Use install_store_app or update_store_app to take action."
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching store applications: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the list_company_apps tool on the MCP server.
 *
 * Lists company-internal (shared internally) applications.
 */
export function registerListCompanyAppsTool(server: McpServer): void {
  server.registerTool(
    "list_company_apps",
    {
      title: "List Company Applications",
      description:
        "List company-internal applications shared within your organization. " +
        "Returns application metadata including name, scope, version, install " +
        "status, and update availability.\n\n" +
        "Optionally filter by scope, sys_id, or installed status.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        scope: z
          .string()
          .optional()
          .describe(
            'Filter by application scope (e.g., "x_acme_my_app"). ' +
              "Returns only the matching application."
          ),
        sys_id: z
          .string()
          .optional()
          .describe(
            "Filter by application sys_id. Returns only the matching application."
          ),
        installed_only: z
          .boolean()
          .default(false)
          .describe("When true, only returns installed applications."),
      },
    },
    async ({ instance, scope, sys_id, installed_only }) => {
      try {
        if (scope && sys_id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Provide either scope or sys_id, not both.",
              },
            ],
            isError: true,
          };
        }

        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const companyApps = new CompanyApplications(snInstance);

            if (scope) {
              const app = await companyApps.getCompanyApplicationByScope(scope);
              return app ? [app] : [];
            }
            if (sys_id) {
              const app =
                await companyApps.getCompanyApplicationBySysId(sys_id);
              return app ? [app] : [];
            }
            if (installed_only) {
              return await companyApps.getInstalledCompanyApplications();
            }
            const response = await companyApps.getCompanyApplications();
            return response.data || [];
          }
        );

        const lines: string[] = [];
        lines.push("=== Company Applications ===");
        if (scope) lines.push(`Filter: scope = ${scope}`);
        else if (sys_id) lines.push(`Filter: sys_id = ${sys_id}`);
        else if (installed_only) lines.push("Filter: installed only");
        lines.push(`Found: ${result.length} application(s)`);

        if (result.length === 0 && (scope || sys_id)) {
          lines.push("");
          lines.push("No matching application found.");
        }

        for (let i = 0; i < result.length; i++) {
          const app = result[i];
          lines.push("");
          lines.push(`${i + 1}. ${app.name}`);
          lines.push(`   sys_id: ${app.sys_id}`);
          lines.push(`   Scope: ${app.scope}`);
          lines.push(`   Version: ${app.version}`);
          if (app.latest_version)
            lines.push(`   Latest Version: ${app.latest_version}`);
          lines.push(`   Installed: ${app.isInstalled}`);
          lines.push(`   Can Install/Upgrade: ${app.can_install_or_upgrade}`);
          if (app.vendor) lines.push(`   Vendor: ${app.vendor}`);
          if (app.short_description) {
            const desc =
              app.short_description.length > 120
                ? app.short_description.slice(0, 120) + "..."
                : app.short_description;
            lines.push(`   Description: ${desc}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing company applications: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the install_store_app tool on the MCP server.
 *
 * Installs a store application and waits for completion.
 */
export function registerInstallStoreAppTool(server: McpServer): void {
  server.registerTool(
    "install_store_app",
    {
      title: "Install Store Application",
      description:
        "Install a ServiceNow store application on the target instance. " +
        "This is a MUTATIVE, LONG-RUNNING operation that blocks until " +
        "installation completes or times out (default: 30 minutes).\n\n" +
        "IMPORTANT:\n" +
        "- Installation adds new tables, scripts, and configuration to the instance.\n" +
        "- Review the application details (use get_app_details) before installing.\n" +
        "- Ensure the instance has sufficient capacity and the right entitlements.\n" +
        "- Consider testing on a sub-production instance first.\n\n" +
        "Use search_store_apps with tab_context 'available_for_you' to find " +
        "apps available for installation.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        app_id: z
          .string()
          .describe(
            "The source app ID of the application to install. " +
              "Use search_store_apps or get_app_details to find this."
          ),
        version: z
          .string()
          .describe(
            'The version to install (e.g., "1.2.3"). ' +
              "Use get_app_details to see available versions."
          ),
        load_demo_data: z
          .boolean()
          .default(false)
          .describe("Whether to load demo data during installation."),
        timeout_minutes: z
          .number()
          .min(1)
          .max(60)
          .default(30)
          .describe(
            "Maximum time to wait for installation to complete, in minutes. Default 30."
          ),
      },
    },
    async ({ instance, app_id, version, load_demo_data, timeout_minutes }) => {
      const startMs = Date.now();
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new ApplicationManager(snInstance);
            return await mgr.installStoreApplicationAndWait(
              {
                appId: app_id,
                version,
                loadDemoData: load_demo_data,
              },
              5000,
              timeout_minutes * 60 * 1000
            );
          }
        );

        const lines: string[] = [];
        if (result.success) {
          lines.push("=== Store Application Installed ===");
        } else {
          lines.push("=== Store Application Installation Failed ===");
        }
        lines.push(`App ID: ${app_id}`);
        lines.push(`Version: ${version}`);
        lines.push(`Status: ${result.status_label}`);
        lines.push(`Message: ${result.status_message}`);
        lines.push(`Completion: ${result.percent_complete}%`);
        if (result.error) lines.push(`Error: ${result.error}`);
        lines.push(`Duration: ${formatDuration(startMs)}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: !result.success,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error installing store application: ${message}\n` +
                `Duration: ${formatDuration(startMs)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the update_store_app tool on the MCP server.
 *
 * Updates an installed store application and waits for completion.
 */
export function registerUpdateStoreAppTool(server: McpServer): void {
  server.registerTool(
    "update_store_app",
    {
      title: "Update Store Application",
      description:
        "Update an installed ServiceNow store application to a newer version. " +
        "This is a MUTATIVE, LONG-RUNNING operation that blocks until " +
        "the update completes or times out (default: 30 minutes).\n\n" +
        "IMPORTANT:\n" +
        "- Updates may alter existing behavior, modify tables, and affect customizations.\n" +
        "- Customizations to the application may be overwritten during the update.\n" +
        "- Consider testing on a sub-production instance first.\n\n" +
        "Use search_store_apps with tab_context 'updates' to find apps " +
        "with available updates.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        app_id: z
          .string()
          .describe(
            "The source app ID of the application to update. " +
              "Use search_store_apps with tab_context 'updates' to find this."
          ),
        version: z
          .string()
          .describe(
            'The version to update to (e.g., "2.0.0"). ' +
              "Use get_app_details to see the latest available version."
          ),
        load_demo_data: z
          .boolean()
          .default(false)
          .describe("Whether to load demo data during the update."),
        timeout_minutes: z
          .number()
          .min(1)
          .max(60)
          .default(30)
          .describe(
            "Maximum time to wait for the update to complete, in minutes. Default 30."
          ),
      },
    },
    async ({ instance, app_id, version, load_demo_data, timeout_minutes }) => {
      const startMs = Date.now();
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new ApplicationManager(snInstance);
            return await mgr.updateStoreApplicationAndWait(
              {
                appId: app_id,
                version,
                loadDemoData: load_demo_data,
              },
              5000,
              timeout_minutes * 60 * 1000
            );
          }
        );

        const lines: string[] = [];
        if (result.success) {
          lines.push("=== Store Application Updated ===");
        } else {
          lines.push("=== Store Application Update Failed ===");
        }
        lines.push(`App ID: ${app_id}`);
        lines.push(`Version: ${version}`);
        lines.push(`Status: ${result.status_label}`);
        lines.push(`Message: ${result.status_message}`);
        lines.push(`Completion: ${result.percent_complete}%`);
        if (result.error) lines.push(`Error: ${result.error}`);
        lines.push(`Duration: ${formatDuration(startMs)}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: !result.success,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error updating store application: ${message}\n` +
                `Duration: ${formatDuration(startMs)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the install_from_app_repo tool on the MCP server.
 *
 * Installs an application from the company app repository (CI/CD).
 */
export function registerInstallFromAppRepoTool(server: McpServer): void {
  server.registerTool(
    "install_from_app_repo",
    {
      title: "Install from App Repository",
      description:
        "Install an application from the company's ServiceNow application " +
        "repository using the CI/CD API. This is a MUTATIVE, LONG-RUNNING " +
        "operation that blocks until installation completes or times out " +
        "(default: 30 minutes).\n\n" +
        "Typically used for deploying custom applications across instances " +
        "(e.g., dev -> test -> prod). Use list_company_apps to find the " +
        "application scope and sys_id.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        scope: z
          .string()
          .describe(
            'The scope name of the application to install (e.g., "x_acme_my_app").'
          ),
        sys_id: z
          .string()
          .describe("The sys_id of the application in the repository."),
        version: z
          .string()
          .optional()
          .describe(
            "Specific version to install. If omitted, installs the latest."
          ),
        auto_upgrade_base_app: z
          .boolean()
          .default(false)
          .describe(
            "Whether to automatically upgrade the base application if required."
          ),
        base_app_version: z
          .string()
          .optional()
          .describe("Specific version of the base application to upgrade to."),
        timeout_minutes: z
          .number()
          .min(1)
          .max(60)
          .default(30)
          .describe(
            "Maximum time to wait for installation to complete, in minutes. Default 30."
          ),
      },
    },
    async ({
      instance,
      scope,
      sys_id,
      version,
      auto_upgrade_base_app,
      base_app_version,
      timeout_minutes,
    }) => {
      const startMs = Date.now();
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const repo = new AppRepoApplication(snInstance);
            return await repo.installFromAppRepoAndWait(
              {
                scope,
                sys_id,
                version,
                auto_upgrade_base_app,
                base_app_version,
              },
              5000,
              timeout_minutes * 60 * 1000
            );
          }
        );

        const lines: string[] = [];
        if (result.success) {
          lines.push("=== App Repo Installation Complete ===");
        } else {
          lines.push("=== App Repo Installation Failed ===");
        }
        lines.push(`Scope: ${scope}`);
        lines.push(`Sys ID: ${sys_id}`);
        lines.push(`Version: ${version || "latest"}`);
        lines.push(`Status: ${result.status_label}`);
        lines.push(`Message: ${result.status_message}`);
        if (result.status_detail)
          lines.push(`Detail: ${result.status_detail}`);
        lines.push(`Completion: ${result.percent_complete}%`);
        if (result.error) lines.push(`Error: ${result.error}`);
        lines.push(`Duration: ${formatDuration(startMs)}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: !result.success,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error installing from app repo: ${message}\n` +
                `Duration: ${formatDuration(startMs)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the publish_to_app_repo tool on the MCP server.
 *
 * Publishes an application to the company app repository.
 */
export function registerPublishToAppRepoTool(server: McpServer): void {
  server.registerTool(
    "publish_to_app_repo",
    {
      title: "Publish to App Repository",
      description:
        "Publish an application to the company's ServiceNow application " +
        "repository using the CI/CD API. This is a MUTATIVE, LONG-RUNNING " +
        "operation that blocks until publishing completes or times out " +
        "(default: 30 minutes).\n\n" +
        "This makes the application version available for installation on " +
        "other instances in the company. Use list_company_apps or lookup_app " +
        "to find the scope and sys_id.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        scope: z
          .string()
          .describe(
            'The scope name of the application to publish (e.g., "x_acme_my_app").'
          ),
        sys_id: z
          .string()
          .describe("The sys_id of the application to publish."),
        version: z
          .string()
          .optional()
          .describe("Version number for the published application."),
        dev_notes: z
          .string()
          .optional()
          .describe("Developer notes for this version."),
        timeout_minutes: z
          .number()
          .min(1)
          .max(60)
          .default(30)
          .describe(
            "Maximum time to wait for publishing to complete, in minutes. Default 30."
          ),
      },
    },
    async ({ instance, scope, sys_id, version, dev_notes, timeout_minutes }) => {
      const startMs = Date.now();
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const repo = new AppRepoApplication(snInstance);
            return await repo.publishToAppRepoAndWait(
              {
                scope,
                sys_id,
                version,
                dev_notes,
              },
              5000,
              timeout_minutes * 60 * 1000
            );
          }
        );

        const lines: string[] = [];
        if (result.success) {
          lines.push("=== App Repo Publish Complete ===");
        } else {
          lines.push("=== App Repo Publish Failed ===");
        }
        lines.push(`Scope: ${scope}`);
        lines.push(`Sys ID: ${sys_id}`);
        lines.push(`Version: ${version || "N/A"}`);
        lines.push(`Status: ${result.status_label}`);
        lines.push(`Message: ${result.status_message}`);
        if (result.status_detail)
          lines.push(`Detail: ${result.status_detail}`);
        lines.push(`Completion: ${result.percent_complete}%`);
        if (result.error) lines.push(`Error: ${result.error}`);
        lines.push(`Duration: ${formatDuration(startMs)}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: !result.success,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Error publishing to app repo: ${message}\n` +
                `Duration: ${formatDuration(startMs)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
