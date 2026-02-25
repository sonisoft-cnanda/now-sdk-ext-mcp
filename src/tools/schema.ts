import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SchemaDiscovery } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the discover_table_schema tool on the MCP server.
 *
 * Discovers the full schema of a ServiceNow table including all fields,
 * types, references, and optionally choice values, relationships,
 * UI policies, and business rules.
 */
export function registerDiscoverTableSchemaTool(server: McpServer): void {
  server.registerTool(
    "discover_table_schema",
    {
      title: "Discover Table Schema",
      description:
        "Discover the full schema of a ServiceNow table including all fields, types, " +
        "references, and optionally choice values, relationships, UI policies, and " +
        "business rules.\n\n" +
        "Returns the table name, label, parent class, and for each field: name, label, " +
        "type, maxLength, mandatory, readOnly, referenceTable, and defaultValue.\n\n" +
        "Key use cases:\n" +
        "- Understand the structure of a table before querying or scripting against it\n" +
        "- Discover reference fields to understand table relationships\n" +
        "- Find choice values for dropdown fields\n" +
        "- Review UI policies and business rules that affect the table",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        table: z
          .string()
          .describe(
            "The ServiceNow table name to discover (e.g., " +
              '"incident", "sys_user", "cmdb_ci").'
          ),
        include_choices: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Include choice values for fields that have them (e.g., " +
              "priority, state). Queries sys_choice."
          ),
        include_relationships: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Include relationship information extracted from reference fields."
          ),
        include_ui_policies: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Include UI policies defined on the table."
          ),
        include_business_rules: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Include business rules defined on the table."
          ),
      },
    },
    async ({
      instance,
      table,
      include_choices,
      include_relationships,
      include_ui_policies,
      include_business_rules,
    }) => {
      try {
        const schema = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const discovery = new SchemaDiscovery(snInstance);
            return await discovery.discoverTableSchema(table, {
              includeChoiceTables: include_choices,
              includeRelationships: include_relationships,
              includeUIPolicies: include_ui_policies,
              includeBusinessRules: include_business_rules,
            });
          }
        );

        const lines: string[] = [];

        lines.push("=== Table Schema ===");
        lines.push(`Table: ${schema.table}`);
        lines.push(`Label: ${schema.label}`);
        if (schema.superClass) {
          lines.push(`Parent Class: ${schema.superClass}`);
        }
        lines.push(`Fields: ${schema.fields.length}`);
        lines.push("");

        // Fields
        lines.push("=== Fields ===");
        for (const field of schema.fields) {
          lines.push("");
          lines.push(`  ${field.name}`);
          lines.push(`    Label: ${field.label}`);
          lines.push(`    Type: ${field.internalType}`);
          lines.push(`    Max Length: ${field.maxLength}`);
          lines.push(`    Mandatory: ${field.mandatory}`);
          lines.push(`    Read Only: ${field.readOnly}`);
          if (field.referenceTable) {
            lines.push(`    Reference Table: ${field.referenceTable}`);
          }
          if (field.defaultValue) {
            lines.push(`    Default Value: ${field.defaultValue}`);
          }
        }

        // Choice tables
        if (schema.choiceTables && schema.choiceTables.length > 0) {
          lines.push("");
          lines.push("=== Choice Values ===");
          for (const choiceTable of schema.choiceTables) {
            lines.push("");
            lines.push(`  Field: ${choiceTable.field}`);
            for (const choice of choiceTable.choices) {
              lines.push(`    ${choice.value} = ${choice.label}`);
            }
          }
        }

        // Relationships
        if (schema.relationships && schema.relationships.length > 0) {
          lines.push("");
          lines.push("=== Relationships ===");
          for (const rel of schema.relationships) {
            lines.push(`  ${rel.name} -> ${rel.relatedTable} (${rel.type})`);
          }
        }

        // UI Policies
        if (schema.uiPolicies && schema.uiPolicies.length > 0) {
          lines.push("");
          lines.push("=== UI Policies ===");
          for (const policy of schema.uiPolicies) {
            lines.push(
              `  ${policy.short_description || "(no description)"} [${policy.active ? "active" : "inactive"}] (sys_id: ${policy.sys_id})`
            );
          }
        }

        // Business Rules
        if (schema.businessRules && schema.businessRules.length > 0) {
          lines.push("");
          lines.push("=== Business Rules ===");
          for (const rule of schema.businessRules) {
            lines.push(
              `  ${rule.name || "(no name)"} [when: ${rule.when}, ${rule.active ? "active" : "inactive"}] (sys_id: ${rule.sys_id})`
            );
          }
        }

        lines.push("");
        lines.push(`=== ${schema.fields.length} field(s) discovered ===`);

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error discovering table schema: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the explain_field tool on the MCP server.
 *
 * Gets a detailed explanation of a specific field on a table, including
 * type, constraints, help text, and available choice values.
 */
export function registerExplainFieldTool(server: McpServer): void {
  server.registerTool(
    "explain_field",
    {
      title: "Explain Field",
      description:
        "Get detailed explanation of a specific field on a ServiceNow table, " +
        "including type, constraints, help text, and available choice values.\n\n" +
        "Use this to understand what a field does, what values it accepts, " +
        "and how it is configured before reading or writing data.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        table: z
          .string()
          .describe(
            "The ServiceNow table name containing the field (e.g., " +
              '"incident", "sys_user").'
          ),
        field: z
          .string()
          .describe(
            "The field element name to explain (e.g., " +
              '"state", "priority", "assigned_to").'
          ),
      },
    },
    async ({ instance, table, field }) => {
      try {
        const explanation = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const discovery = new SchemaDiscovery(snInstance);
            return await discovery.explainField(table, field);
          }
        );

        const lines: string[] = [];

        lines.push("=== Field Explanation ===");
        lines.push(`Field: ${explanation.field}`);
        lines.push(`Table: ${explanation.table}`);
        lines.push(`Label: ${explanation.label}`);
        lines.push(`Type: ${explanation.type}`);
        lines.push(`Max Length: ${explanation.maxLength}`);
        lines.push(`Mandatory: ${explanation.mandatory}`);
        lines.push(`Read Only: ${explanation.readOnly}`);

        if (explanation.comments) {
          lines.push(`Comments: ${explanation.comments}`);
        }
        if (explanation.help) {
          lines.push(`Help: ${explanation.help}`);
        }
        if (explanation.referenceTable) {
          lines.push(`Reference Table: ${explanation.referenceTable}`);
        }

        if (explanation.choices && explanation.choices.length > 0) {
          lines.push("");
          lines.push("=== Available Choices ===");
          for (const choice of explanation.choices) {
            lines.push(`  ${choice.value} = ${choice.label}`);
          }
          lines.push("");
          lines.push(`=== ${explanation.choices.length} choice(s) ===`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error explaining field: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the validate_catalog tool on the MCP server.
 *
 * Validates a catalog item's configuration, checking variables for
 * duplicates, missing names, inactive mandatory vars, and UI policy issues.
 */
export function registerValidateCatalogTool(server: McpServer): void {
  server.registerTool(
    "validate_catalog",
    {
      title: "Validate Catalog Configuration",
      description:
        "Validate a catalog item's configuration on a ServiceNow instance. " +
        "Checks variables for duplicates, missing names, inactive mandatory " +
        "variables, and UI policy issues.\n\n" +
        "Returns a valid/invalid flag, error and warning counts, and each " +
        "issue with its severity, component, sys_id, description, and suggested fix.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        catalog_item_sys_id: z
          .string()
          .describe(
            "The sys_id of the catalog item to validate."
          ),
      },
    },
    async ({ instance, catalog_item_sys_id }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const discovery = new SchemaDiscovery(snInstance);
            return await discovery.validateCatalogConfiguration(
              catalog_item_sys_id
            );
          }
        );

        const lines: string[] = [];

        lines.push("=== Catalog Validation Result ===");
        lines.push(`Catalog Item: ${catalog_item_sys_id}`);
        lines.push(`Valid: ${result.valid}`);
        lines.push(`Errors: ${result.errors}`);
        lines.push(`Warnings: ${result.warnings}`);

        if (result.issues.length > 0) {
          lines.push("");
          lines.push("=== Issues ===");
          for (const issue of result.issues) {
            lines.push("");
            lines.push(
              `  [${issue.severity.toUpperCase()}] ${issue.issue}`
            );
            lines.push(`    Component: ${issue.component}`);
            if (issue.sys_id) {
              lines.push(`    sys_id: ${issue.sys_id}`);
            }
            if (issue.fix) {
              lines.push(`    Fix: ${issue.fix}`);
            }
          }
        } else {
          lines.push("");
          lines.push("No issues found. The catalog item configuration is valid.");
        }

        lines.push("");
        lines.push(
          `=== ${result.issues.length} issue(s): ${result.errors} error(s), ${result.warnings} warning(s) ===`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error validating catalog configuration: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
