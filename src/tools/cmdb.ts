import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CMDBRelationships } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the get_cmdb_relationships tool on the MCP server.
 *
 * Returns direct (single-level) upstream and/or downstream relationships for a CI.
 */
export function registerGetCmdbRelationshipsTool(server: McpServer): void {
  server.registerTool(
    "get_cmdb_relationships",
    {
      title: "Get CMDB Relationships",
      description:
        "Get direct relationships of a CMDB Configuration Item (CI). Returns upstream, " +
        "downstream, or both relationship directions. Use this for impact analysis, " +
        "dependency mapping, and understanding CI topology.\n\n" +
        "Provide the CI sys_id (from cmdb_ci or any CI class table). Optionally filter " +
        "by relationship type (e.g., 'Depends on::Used by', 'Contains::Contained by').",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        ci_sys_id: z
          .string()
          .describe("The sys_id of the Configuration Item to get relationships for."),
        direction: z
          .enum(["upstream", "downstream", "both"])
          .default("both")
          .describe(
            'Relationship direction: "upstream" (parents/dependencies), ' +
              '"downstream" (children/dependents), or "both". Default is "both".'
          ),
        relation_type: z
          .string()
          .optional()
          .describe(
            'Filter by relationship type name (e.g., "Depends on::Used by", ' +
              '"Contains::Contained by"). If omitted, returns all relationship types.'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Maximum number of relationships to return. Default is 100."),
      },
    },
    async ({ instance, ci_sys_id, direction, relation_type, limit }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const cmdb = new CMDBRelationships(snInstance);
            return await cmdb.getRelationships({
              ciSysId: ci_sys_id,
              direction,
              relationType: relation_type,
              limit,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== CMDB Relationships ===");
        if (result.ci) {
          lines.push(
            `CI: ${result.ci.name || result.ci.sys_id} (${result.ci.sys_class_name || "unknown class"})`
          );
        }
        lines.push(`Direction: ${direction}`);
        if (relation_type) lines.push(`Relation Type Filter: ${relation_type}`);
        lines.push(`Relationships found: ${result.relationships?.length ?? 0}`);

        if (result.relationships && result.relationships.length > 0) {
          for (const rel of result.relationships) {
            lines.push("");
            lines.push(`--- Relationship ---`);
            lines.push(JSON.stringify(rel, null, 2));
          }
        } else {
          lines.push("");
          lines.push("No relationships found.");
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
              text: `Error getting CMDB relationships: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the traverse_cmdb_graph tool on the MCP server.
 *
 * Performs a multi-level BFS traversal of the CMDB relationship graph.
 */
export function registerTraverseCmdbGraphTool(server: McpServer): void {
  server.registerTool(
    "traverse_cmdb_graph",
    {
      title: "Traverse CMDB Graph",
      description:
        "Traverse the CMDB relationship graph starting from a Configuration Item using " +
        "breadth-first search. Returns all nodes (CIs) and edges (relationships) discovered " +
        "up to the specified depth.\n\n" +
        "Use this for deep impact analysis, service mapping, and understanding the full " +
        "dependency chain of a CI. Max depth is 5, max nodes is 1000.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        ci_sys_id: z
          .string()
          .describe("The sys_id of the root Configuration Item to start traversal from."),
        direction: z
          .enum(["upstream", "downstream", "both"])
          .default("both")
          .describe(
            'Traversal direction: "upstream", "downstream", or "both". Default is "both".'
          ),
        max_depth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(2)
          .describe(
            "Maximum traversal depth (1-5). Higher depth discovers more of the graph " +
              "but makes more API calls. Default is 2."
          ),
        relation_type: z
          .string()
          .optional()
          .describe(
            "Filter traversal to only follow this relationship type."
          ),
        max_nodes: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(200)
          .describe(
            "Maximum number of nodes to visit. Traversal stops when this limit is " +
              "reached. Default is 200, max is 1000."
          ),
      },
    },
    async ({
      instance,
      ci_sys_id,
      direction,
      max_depth,
      relation_type,
      max_nodes,
    }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const cmdb = new CMDBRelationships(snInstance);
            return await cmdb.traverseGraph({
              ciSysId: ci_sys_id,
              direction,
              maxDepth: max_depth,
              relationType: relation_type,
              maxNodes: max_nodes,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== CMDB Graph Traversal ===");
        if (result.rootCI) {
          lines.push(
            `Root CI: ${result.rootCI.name || result.rootCI.sys_id} (${result.rootCI.sys_class_name || "unknown"})`
          );
        }
        lines.push(`Direction: ${direction}`);
        lines.push(`Max Depth: ${max_depth}`);
        lines.push(`Nodes discovered: ${result.nodes?.length ?? 0}`);
        lines.push(`Edges discovered: ${result.edges?.length ?? 0}`);
        lines.push(`API calls made: ${result.apiCallCount ?? 0}`);
        if (result.truncated) {
          lines.push(
            `WARNING: Traversal was truncated — ${result.truncationReason || "limit reached"}`
          );
        }

        if (result.nodes && result.nodes.length > 0) {
          lines.push("");
          lines.push("--- Nodes ---");
          for (const node of result.nodes) {
            lines.push(
              `  [depth=${node.depth}] ${node.name || node.sysId} (${node.className || "unknown"}) — ${node.sysId}`
            );
          }
        }

        if (result.edges && result.edges.length > 0) {
          lines.push("");
          lines.push("--- Edges ---");
          for (const edge of result.edges) {
            lines.push(
              `  ${edge.parentSysId} --[${edge.typeName || "related"}]--> ${edge.childSysId}`
            );
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
              text: `Error traversing CMDB graph: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
