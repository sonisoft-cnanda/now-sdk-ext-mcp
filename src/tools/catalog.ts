import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CatalogManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Instance parameter description shared across catalog tools.
 */
const INSTANCE_DESC =
  "The ServiceNow instance auth alias to use. " +
  'This is the alias configured via `now-sdk auth --add` (e.g., "dev224436", "prod", "test"). ' +
  'The user will typically refer to this by name when saying things like "on my dev224436 instance". ' +
  "If not provided, falls back to the SN_AUTH_ALIAS environment variable.";

// ============================================================
// 1. list_catalog_items
// ============================================================

export function registerListCatalogItemsTool(server: McpServer): void {
  server.registerTool(
    "list_catalog_items",
    {
      title: "List Catalog Items",
      description:
        "List service catalog items from the sc_cat_item table. Supports text search " +
        "on item name and description, filtering by category, catalog, and active status.\n\n" +
        "Use this to browse or search for available catalog offerings before getting " +
        "item details or submitting a request.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        text_search: z
          .string()
          .optional()
          .describe("Search catalog items by name or short description (contains match)."),
        category_sys_id: z
          .string()
          .optional()
          .describe("Filter items by category sys_id."),
        catalog_sys_id: z
          .string()
          .optional()
          .describe("Filter items by catalog sys_id (sc_catalogs field)."),
        active: z.boolean().optional().describe("Filter by active status. Omit to return all."),
        query: z.string().optional().describe("Optional encoded query for additional filtering."),
        limit: z.number().int().min(1).default(20).describe("Maximum number of records to return (default 20)."),
        offset: z.number().int().min(0).default(0).describe("Number of records to skip for pagination (default 0)."),
      },
    },
    async ({ instance, text_search, category_sys_id, catalog_sys_id, active, query, limit, offset }) => {
      try {
        const results = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new CatalogManager(snInstance);
          return await mgr.listCatalogItems({
            textSearch: text_search,
            categorySysId: category_sys_id,
            catalogSysId: catalog_sys_id,
            active,
            query,
            limit,
            offset,
          });
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No catalog items found." }],
          };
        }

        const lines = results.map(
          (item) =>
            `- ${item.name}: ${item.short_description || "(no description)"} ` +
            `(sys_id: ${item.sys_id}, active: ${item.active})`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} catalog item(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing catalog items: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 2. get_catalog_item
// ============================================================

export function registerGetCatalogItemTool(server: McpServer): void {
  server.registerTool(
    "get_catalog_item",
    {
      title: "Get Catalog Item Details",
      description:
        "Get details of a specific service catalog item by sys_id, optionally including " +
        "its variables (form fields). Use this to understand what a catalog item offers " +
        "and what information is needed before submitting a request.\n\n" +
        "Set include_variables to true (default) to also retrieve the item's form fields.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z.string().describe("The sys_id of the catalog item."),
        include_variables: z
          .boolean()
          .default(true)
          .describe("Whether to include the item's variables/form fields (default true)."),
      },
    },
    async ({ instance, sys_id, include_variables }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new CatalogManager(snInstance);
          return await mgr.getCatalogItem(sys_id, include_variables);
        });

        const item = result.item;
        let text =
          `Catalog Item: ${item.name}\n` +
          `sys_id: ${item.sys_id}\n` +
          `Short Description: ${item.short_description || "N/A"}\n` +
          `Category: ${item.category || "N/A"}\n` +
          `Active: ${item.active}\n` +
          `Price: ${item.price || "N/A"}`;

        if (result.variables && result.variables.length > 0) {
          text += `\n\nVariables (${result.variables.length}):\n`;
          text += result.variables
            .map(
              (v) =>
                `  - ${v.name}: ${v.question_text || "(no label)"} ` +
                `[type: ${v.friendly_type || v.type}, mandatory: ${v.mandatory || "false"}]` +
                (v.default_value ? `, default: ${v.default_value}` : "")
            )
            .join("\n");
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error getting catalog item: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 3. list_catalog_categories
// ============================================================

export function registerListCatalogCategoriesTool(server: McpServer): void {
  server.registerTool(
    "list_catalog_categories",
    {
      title: "List Catalog Categories",
      description:
        "List service catalog categories from the sc_category table. Filter by parent " +
        "category, catalog, active status, or title. Use this to browse the catalog's " +
        "organizational structure.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        parent_sys_id: z
          .string()
          .optional()
          .describe("Filter by parent category sys_id to get subcategories."),
        catalog_sys_id: z
          .string()
          .optional()
          .describe("Filter categories by catalog sys_id."),
        active: z.boolean().optional().describe("Filter by active status. Omit to return all."),
        title: z.string().optional().describe("Filter by exact category title."),
        query: z.string().optional().describe("Optional encoded query for additional filtering."),
        limit: z.number().int().min(1).default(20).describe("Maximum number of records to return (default 20)."),
        offset: z.number().int().min(0).default(0).describe("Number of records to skip for pagination (default 0)."),
      },
    },
    async ({ instance, parent_sys_id, catalog_sys_id, active, title, query, limit, offset }) => {
      try {
        const results = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new CatalogManager(snInstance);
          return await mgr.listCatalogCategories({
            parentSysId: parent_sys_id,
            catalogSysId: catalog_sys_id,
            active,
            title,
            query,
            limit,
            offset,
          });
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No catalog categories found." }],
          };
        }

        const lines = results.map(
          (cat) =>
            `- ${cat.title}: ${cat.description || "(no description)"} ` +
            `(sys_id: ${cat.sys_id}, active: ${cat.active})`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} catalog category(ies):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing catalog categories: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 4. get_catalog_category
// ============================================================

export function registerGetCatalogCategoryTool(server: McpServer): void {
  server.registerTool(
    "get_catalog_category",
    {
      title: "Get Catalog Category Details",
      description:
        "Get details of a specific service catalog category by sys_id, including the " +
        "count of items in that category.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z.string().describe("The sys_id of the catalog category."),
      },
    },
    async ({ instance, sys_id }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new CatalogManager(snInstance);
          return await mgr.getCatalogCategory(sys_id);
        });

        const cat = result.category;
        const text =
          `Category: ${cat.title}\n` +
          `sys_id: ${cat.sys_id}\n` +
          `Description: ${cat.description || "N/A"}\n` +
          `Active: ${cat.active}\n` +
          `Parent: ${cat.parent || "N/A"}\n` +
          `Items in Category: ${result.itemCount}`;

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error getting catalog category: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 5. list_catalog_item_variables
// ============================================================

export function registerListCatalogItemVariablesTool(server: McpServer): void {
  server.registerTool(
    "list_catalog_item_variables",
    {
      title: "List Catalog Item Variables",
      description:
        "List the variables (form fields) for a specific catalog item. Returns variable " +
        "names, types, whether they are mandatory, default values, and help text. " +
        "Includes variables from associated variable sets by default.\n\n" +
        "Essential for understanding what data to provide when using submit_catalog_request. " +
        "Variable types include: Single Line Text, Multi Line Text, Select Box, Reference, " +
        "CheckBox, Date, Yes/No, and more.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        catalog_item_sys_id: z
          .string()
          .describe("The sys_id of the catalog item to list variables for."),
        include_variable_sets: z
          .boolean()
          .default(true)
          .describe(
            "Whether to include variables from associated variable sets (default true). " +
            "Set to false to only get directly-assigned variables."
          ),
      },
    },
    async ({ instance, catalog_item_sys_id, include_variable_sets }) => {
      try {
        const results = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new CatalogManager(snInstance);
          return await mgr.listCatalogItemVariables({
            catalogItemSysId: catalog_item_sys_id,
            includeVariableSets: include_variable_sets,
          });
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No variables found for this catalog item." }],
          };
        }

        const lines = results.map(
          (v) =>
            `- ${v.name}: ${v.question_text || "(no label)"}\n` +
            `    Type: ${v.friendly_type || v.type}, Mandatory: ${v.mandatory || "false"}` +
            (v.default_value ? `, Default: ${v.default_value}` : "") +
            (v.help_text ? `\n    Help: ${v.help_text}` : "") +
            (v.reference ? `\n    Reference: ${v.reference}` : "")
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} variable(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing catalog item variables: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 6. submit_catalog_request
// ============================================================

export function registerSubmitCatalogRequestTool(server: McpServer): void {
  server.registerTool(
    "submit_catalog_request",
    {
      title: "Submit Catalog Request",
      description:
        "Submit a service catalog request using the ServiceNow order_now API. Returns " +
        "the request (REQ) and request item (RITM) numbers.\n\n" +
        "IMPORTANT: This creates a real service request on the instance. Use " +
        "list_catalog_item_variables first to understand what variables are required. " +
        "Variable values should be passed as a key-value object where keys are the " +
        "variable names and values are strings. For reference-type variables, pass " +
        "the sys_id of the referenced record.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        catalog_item_sys_id: z
          .string()
          .describe("The sys_id of the catalog item to order."),
        quantity: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("Number of items to request (default 1)."),
        variables: z
          .record(z.string())
          .optional()
          .describe(
            "Variable values for the catalog item form as key-value pairs. " +
            "Keys are variable names, values are strings. For reference fields, " +
            "use the sys_id of the referenced record."
          ),
      },
    },
    async ({ instance, catalog_item_sys_id, quantity, variables }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new CatalogManager(snInstance);
          return await mgr.submitCatalogRequest({
            catalogItemSysId: catalog_item_sys_id,
            quantity,
            variables,
          });
        });

        let text = `Catalog request submitted successfully.\n`;
        text += `Request: ${result.requestNumber} (sys_id: ${result.requestSysId})`;
        if (result.requestItemNumber) {
          text += `\nRequest Item: ${result.requestItemNumber} (sys_id: ${result.requestItemSysId})`;
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error submitting catalog request: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
