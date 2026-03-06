import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KnowledgeManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Instance parameter description shared across knowledge tools.
 */
const INSTANCE_DESC =
  "The ServiceNow instance auth alias to use. " +
  'This is the alias configured via `now-sdk auth --add` (e.g., "dev224436", "prod", "test"). ' +
  'The user will typically refer to this by name when saying things like "on my dev224436 instance". ' +
  "If not provided, falls back to the SN_AUTH_ALIAS environment variable.";

// ============================================================
// 1. list_knowledge_bases
// ============================================================

export function registerListKnowledgeBasesTool(server: McpServer): void {
  server.registerTool(
    "list_knowledge_bases",
    {
      title: "List Knowledge Bases",
      description:
        "List knowledge bases on a ServiceNow instance. Returns knowledge base records " +
        "from the kb_knowledge_base table with optional filtering by active status and " +
        "encoded query. Use this to discover available KBs before browsing articles or categories.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        query: z
          .string()
          .optional()
          .describe(
            "Optional encoded query to filter knowledge bases " +
            '(e.g., "titleLIKEIT" to find KBs with "IT" in the title).'
          ),
        active: z
          .boolean()
          .optional()
          .describe("Filter by active status. Omit to return all."),
        limit: z
          .number()
          .default(20)
          .describe("Maximum number of records to return (default 20, max 200)."),
        offset: z
          .number()
          .default(0)
          .describe("Number of records to skip for pagination (default 0)."),
      },
    },
    async ({ instance, query, active, limit, offset }) => {
      try {
        const results = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.listKnowledgeBases({ query, active, limit, offset });
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No knowledge bases found." }],
          };
        }

        const lines = results.map(
          (kb) =>
            `- ${kb.title} (sys_id: ${kb.sys_id}, active: ${kb.active})`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} knowledge base(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing knowledge bases: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 2. get_knowledge_base
// ============================================================

export function registerGetKnowledgeBaseTool(server: McpServer): void {
  server.registerTool(
    "get_knowledge_base",
    {
      title: "Get Knowledge Base Details",
      description:
        "Get details of a specific knowledge base by sys_id, including the total number " +
        "of articles and categories. Use this to understand the scope of a KB before " +
        "browsing its contents.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z.string().describe("The sys_id of the knowledge base."),
      },
    },
    async ({ instance, sys_id }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.getKnowledgeBase(sys_id);
        });

        const kb = result.knowledgeBase;
        const text =
          `Knowledge Base: ${kb.title}\n` +
          `sys_id: ${kb.sys_id}\n` +
          `Active: ${kb.active}\n` +
          `Articles: ${result.articleCount}\n` +
          `Categories: ${result.categoryCount}`;

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error getting knowledge base: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 3. list_kb_categories
// ============================================================

export function registerListKbCategoriesTool(server: McpServer): void {
  server.registerTool(
    "list_kb_categories",
    {
      title: "List Knowledge Categories",
      description:
        "List knowledge base categories from the kb_category table. Filter by knowledge " +
        "base, parent category, active status, or encoded query. Use this to understand " +
        "a KB's taxonomy before creating or categorizing articles.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        knowledge_base_sys_id: z
          .string()
          .optional()
          .describe("Filter categories by knowledge base sys_id."),
        parent_category: z
          .string()
          .optional()
          .describe("Filter by parent category sys_id to get subcategories."),
        query: z.string().optional().describe("Optional encoded query for additional filtering."),
        active: z.boolean().optional().describe("Filter by active status. Omit to return all."),
        limit: z.number().default(20).describe("Maximum number of records to return (default 20)."),
        offset: z.number().default(0).describe("Number of records to skip for pagination (default 0)."),
      },
    },
    async ({ instance, knowledge_base_sys_id, parent_category, query, active, limit, offset }) => {
      try {
        const results = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.listCategories({
            knowledgeBaseSysId: knowledge_base_sys_id,
            parentCategory: parent_category,
            query,
            active,
            limit,
            offset,
          });
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No categories found." }],
          };
        }

        const lines = results.map(
          (cat) => `- ${cat.label} (sys_id: ${cat.sys_id}, active: ${cat.active})`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} category(ies):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing categories: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 4. create_kb_category
// ============================================================

export function registerCreateKbCategoryTool(server: McpServer): void {
  server.registerTool(
    "create_kb_category",
    {
      title: "Create Knowledge Category",
      description:
        "Create a new category in a knowledge base. Requires a label and the knowledge " +
        "base sys_id. Optionally set a parent category for subcategories.\n\n" +
        "IMPORTANT: This creates a new category on the instance.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        label: z.string().describe("The display label for the new category."),
        knowledge_base_sys_id: z
          .string()
          .describe("The sys_id of the knowledge base to create the category in."),
        parent_category: z
          .string()
          .optional()
          .describe("Optional parent category sys_id for creating subcategories."),
        active: z
          .boolean()
          .optional()
          .describe("Whether the category is active (default true)."),
      },
    },
    async ({ instance, label, knowledge_base_sys_id, parent_category, active }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.createCategory({
            label,
            knowledgeBaseSysId: knowledge_base_sys_id,
            parentCategory: parent_category,
            active,
          });
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Category '${result.label}' created successfully (sys_id: ${result.sys_id}).`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error creating category: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 5. list_kb_articles
// ============================================================

export function registerListKbArticlesTool(server: McpServer): void {
  server.registerTool(
    "list_kb_articles",
    {
      title: "List Knowledge Articles",
      description:
        "List knowledge article summaries from the kb_knowledge table. Returns lightweight " +
        "records without body content for efficiency. Filter by knowledge base, category, " +
        "workflow state (draft/published/retired), text search on title, or encoded query.\n\n" +
        "Use get_kb_article to retrieve the full article body content.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        knowledge_base_sys_id: z
          .string()
          .optional()
          .describe("Filter articles by knowledge base sys_id."),
        category_sys_id: z
          .string()
          .optional()
          .describe("Filter articles by category sys_id."),
        workflow_state: z
          .enum(["draft", "published", "retired"])
          .optional()
          .describe("Filter by workflow state: 'draft', 'published', or 'retired'."),
        text_search: z
          .string()
          .optional()
          .describe("Search articles by title (short_description contains this text)."),
        query: z.string().optional().describe("Optional encoded query for additional filtering."),
        limit: z.number().default(20).describe("Maximum number of records to return (default 20)."),
        offset: z.number().default(0).describe("Number of records to skip for pagination (default 0)."),
      },
    },
    async ({ instance, knowledge_base_sys_id, category_sys_id, workflow_state, text_search, query, limit, offset }) => {
      try {
        const results = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.listArticles({
            knowledgeBaseSysId: knowledge_base_sys_id,
            categorySysId: category_sys_id,
            workflowState: workflow_state,
            textSearch: text_search,
            query,
            limit,
            offset,
          });
        });

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No articles found." }],
          };
        }

        const lines = results.map(
          (a) =>
            `- ${a.number}: ${a.short_description} (state: ${a.workflow_state}, sys_id: ${a.sys_id})`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} article(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing articles: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 6. get_kb_article
// ============================================================

export function registerGetKbArticleTool(server: McpServer): void {
  server.registerTool(
    "get_kb_article",
    {
      title: "Get Knowledge Article",
      description:
        "Get the full content of a knowledge article by sys_id, including the HTML body text. " +
        "Use this when you need to read, review, or extract content from an article.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z.string().describe("The sys_id of the knowledge article."),
      },
    },
    async ({ instance, sys_id }) => {
      try {
        const article = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.getArticle(sys_id);
        });

        const text =
          `Article: ${article.short_description}\n` +
          `Number: ${article.number}\n` +
          `sys_id: ${article.sys_id}\n` +
          `Workflow State: ${article.workflow_state}\n` +
          `Active: ${article.active}\n` +
          `Article Type: ${article.article_type || "N/A"}\n` +
          `KB: ${article.kb_knowledge_base}\n` +
          `Category: ${article.kb_category || "N/A"}\n\n` +
          `--- Body ---\n${article.text || article.wiki || "(No body content)"}`;

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error getting article: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 7. create_kb_article
// ============================================================

export function registerCreateKbArticleTool(server: McpServer): void {
  server.registerTool(
    "create_kb_article",
    {
      title: "Create Knowledge Article",
      description:
        "Create a new knowledge article in a specified knowledge base. The article is " +
        "created in 'draft' workflow state by default. Use publish_kb_article to make " +
        "it visible to end users.\n\n" +
        "The body content can be provided as HTML (text field) or wiki markup (wiki field). " +
        "HTML is the more common format.\n\n" +
        "IMPORTANT: This creates a new article on the instance.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        short_description: z
          .string()
          .describe("The article title/short description."),
        knowledge_base_sys_id: z
          .string()
          .describe("The sys_id of the knowledge base to create the article in."),
        text: z
          .string()
          .optional()
          .describe("The article body content in HTML format."),
        wiki: z
          .string()
          .optional()
          .describe("The article body content in wiki markup format (alternative to HTML)."),
        category_sys_id: z
          .string()
          .optional()
          .describe("The sys_id of the category to assign the article to."),
        article_type: z
          .string()
          .optional()
          .describe("The article type (e.g., 'text', 'wiki'). Defaults to platform default."),
        workflow_state: z
          .string()
          .default("draft")
          .describe("The initial workflow state: 'draft' (default), 'published', or 'retired'."),
        additional_fields: z
          .record(z.string())
          .optional()
          .describe("Optional additional fields to set on the article record as key-value pairs."),
      },
    },
    async ({
      instance,
      short_description,
      knowledge_base_sys_id,
      text,
      wiki,
      category_sys_id,
      article_type,
      workflow_state,
      additional_fields,
    }) => {
      try {
        const article = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.createArticle({
            shortDescription: short_description,
            knowledgeBaseSysId: knowledge_base_sys_id,
            text,
            wiki,
            categorySysId: category_sys_id,
            articleType: article_type,
            workflowState: workflow_state,
            additionalFields: additional_fields,
          });
        });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Article '${article.short_description}' created successfully.\n` +
                `Number: ${article.number}\n` +
                `sys_id: ${article.sys_id}\n` +
                `Workflow State: ${article.workflow_state}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error creating article: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 8. update_kb_article
// ============================================================

export function registerUpdateKbArticleTool(server: McpServer): void {
  server.registerTool(
    "update_kb_article",
    {
      title: "Update Knowledge Article",
      description:
        "Update an existing knowledge article's fields. Only the fields provided will " +
        "be modified; all others remain unchanged.\n\n" +
        "IMPORTANT: This modifies the article on the instance.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z.string().describe("The sys_id of the article to update."),
        short_description: z.string().optional().describe("Updated article title."),
        text: z.string().optional().describe("Updated body content in HTML format."),
        wiki: z.string().optional().describe("Updated body content in wiki markup format."),
        knowledge_base_sys_id: z
          .string()
          .optional()
          .describe("Move the article to a different knowledge base."),
        category_sys_id: z
          .string()
          .optional()
          .describe("Change the article's category."),
        workflow_state: z
          .string()
          .optional()
          .describe("Change the workflow state ('draft', 'published', 'retired')."),
        article_type: z.string().optional().describe("Change the article type."),
        active: z.boolean().optional().describe("Set the article's active flag."),
        additional_fields: z
          .record(z.string())
          .optional()
          .describe("Optional additional fields to update as key-value pairs."),
      },
    },
    async ({
      instance,
      sys_id,
      short_description,
      text,
      wiki,
      knowledge_base_sys_id,
      category_sys_id,
      workflow_state,
      article_type,
      active,
      additional_fields,
    }) => {
      try {
        const article = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.updateArticle(sys_id, {
            shortDescription: short_description,
            text,
            wiki,
            knowledgeBaseSysId: knowledge_base_sys_id,
            categorySysId: category_sys_id,
            workflowState: workflow_state,
            articleType: article_type,
            active,
            additionalFields: additional_fields,
          });
        });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Article '${article.short_description}' updated successfully.\n` +
                `sys_id: ${article.sys_id}\n` +
                `Workflow State: ${article.workflow_state}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error updating article: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 9. publish_kb_article
// ============================================================

export function registerPublishKbArticleTool(server: McpServer): void {
  server.registerTool(
    "publish_kb_article",
    {
      title: "Publish Knowledge Article",
      description:
        "Publish a draft knowledge article by setting its workflow_state to 'published'. " +
        "This makes the article visible to end users who have access to the knowledge base.\n\n" +
        "IMPORTANT: This makes the article publicly visible. Ensure the content has been " +
        "reviewed before publishing.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        sys_id: z.string().describe("The sys_id of the article to publish."),
      },
    },
    async ({ instance, sys_id }) => {
      try {
        const article = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new KnowledgeManager(snInstance);
          return await mgr.publishArticle(sys_id);
        });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Article '${article.short_description}' published successfully.\n` +
                `Number: ${article.number}\n` +
                `sys_id: ${article.sys_id}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error publishing article: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
