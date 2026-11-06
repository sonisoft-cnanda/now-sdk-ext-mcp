import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  WorkflowManager,
  generateFluentFlow,
  planFlowConversion,
  renderFlowPlan,
  renderWorkflowAnalysis,
  renderWorkflowMermaid,
  renderWorkflowNodes,
  renderWorkflowOutline,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";
import { instanceParam } from "./working-set.js";
import { clean, cleanMessage, dataBlock as sharedDataBlock, text } from "../common/tool-text.js";

/**
 * Legacy Workflow Editor workflows, as `nex workflow list|show|definitions|export|outline|convert|validate` do. No
 * workflow is changed. All but validate_workflow only read; validate_workflow renders the editor's report page, which
 * saves that run's results over the previous run's, so it is annotated as a (settling) write. Workflow content is
 * instance data: returned as text to read, never as instructions, redacted and fenced by tagged start and end markers.
 */

const dataBlock = (body: string): string =>
  sharedDataBlock(body, "Workflow content", "e.g. outline_workflow without full_scripts, or get_workflow with include_variables false");

function errorText(action: string, error: unknown) {
  return {
    ...text([`Error (${action}): ${cleanMessage(error instanceof Error ? error.message : String(error))}`]),
    isError: true,
  };
}

const workflowParam = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}^]*$/u, "no control characters or ^")
  .describe("The workflow's name or sys_id, or a workflow version sys_id.");
const versionParam = z
  .enum(["current", "published", "draft"])
  .optional()
  .describe(
    "Which version: current (default: your draft if you have one, else the published one), published, or draft. " +
      "Ignored when workflow is a version sys_id."
  );

export function registerListWorkflowsTool(server: McpServer): void {
  server.registerTool(
    "list_workflows",
    {
      annotations: annotationsFor("list_workflows"),
      title: "List Workflows",
      description: "List legacy Workflow Editor workflows with the state of their published and checked-out versions.",
      inputSchema: {
        instance: instanceParam,
        name: z.string().max(100).regex(/^[^\p{Cc}^]*$/u).optional().describe("Name contains this text."),
        table: z.string().regex(/^[a-z0-9_]{1,80}$/).optional().describe("The workflow's table, e.g. sc_req_item."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum workflows to list. Default 50."),
      },
    },
    async ({ instance, name, table, limit }) => {
      try {
        const workflows = await withConnectionRetry(instance, (sn) =>
          new WorkflowManager(sn).findWorkflows({ name, table, limit: limit ?? 50 })
        );
        return text([
          `${workflows.length} workflow(s)`,
          ...workflows.map(
            (w) =>
              `- ${clean(w.name)} (${clean(w.sysId)}) on ${clean(w.table) || "(no table)"}; published: ${clean(w.publishedVersionSysId) || "none"}` +
              (w.checkedOutVersion
                ? `; checked out (${clean(w.checkedOutVersion.sysId)}) by ${clean(w.checkedOutVersion.checkedOutByName ?? w.checkedOutVersion.checkedOutBy)}` +
                  `${w.checkedOutVersion.byCurrentUser ? " (you)" : ""}`
                : "")
          ),
        ]);
      } catch (error) {
        return errorText("list_workflows", error);
      }
    }
  );
}

/**
 * The version to read, as core's exportWorkflow picks it (this mirrors its private resolveVersionToRead, so the
 * export-based tools and these two agree on current, published and draft): a version sys_id as given; otherwise, for current, your
 * draft, else the published version, else someone else's checkout. resolveWorkflow accepts a version sys_id and
 * returns its workflow, so a 32-hex ref that is not the workflow's own sys_id was a version. Its errors (no match,
 * an ambiguous name) are the useful ones and pass through.
 */
async function readableVersion(wm: WorkflowManager, ref: string, which: "current" | "published" | "draft" = "current"): Promise<string> {
  const summary = await wm.resolveWorkflow(ref);
  if (/^[0-9a-f]{32}$/.test(ref) && summary.sysId !== ref) return ref;
  const mine = summary.checkedOutVersion?.byCurrentUser ? summary.checkedOutVersion.sysId : undefined;
  const chosen =
    which === "draft" ? mine
    : which === "published" ? summary.publishedVersionSysId
    : mine ?? summary.publishedVersionSysId ?? summary.checkedOutVersion?.sysId;
  if (!chosen) {
    throw new Error(
      which === "draft"
        ? `Workflow '${clean(summary.name)}' has no version checked out by you.`
        : `Workflow '${clean(summary.name)}' has no ${which === "published" ? "published" : "published or checked-out"} version.`
    );
  }
  return chosen;
}

export function registerGetWorkflowTool(server: McpServer): void {
  server.registerTool(
    "get_workflow",
    {
      annotations: annotationsFor("get_workflow"),
      title: "Get Workflow",
      description:
        "Read one legacy workflow version's definition as JSON: its activities with their exits (and variable values), " +
        "transitions, stages and editor status. For a readable view use outline_workflow.",
      inputSchema: {
        instance: instanceParam,
        workflow: workflowParam,
        version: versionParam,
        include_variables: z.boolean().optional().describe("Include each activity's variable values (scripts included). Default true."),
      },
    },
    async ({ instance, workflow, version, include_variables }) => {
      try {
        const definition = await withConnectionRetry(instance, async (sn) => {
          const wm = new WorkflowManager(sn);
          return wm.getWorkflowDefinition(await readableVersion(wm, workflow, version), { includeVariables: include_variables !== false });
        });
        return text([dataBlock(JSON.stringify(definition, null, 2))]);
      } catch (error) {
        return errorText("get_workflow", error);
      }
    }
  );
}

export function registerOutlineWorkflowTool(server: McpServer): void {
  server.registerTool(
    "outline_workflow",
    {
      annotations: annotationsFor("outline_workflow"),
      title: "Outline Workflow",
      description:
        "Show a legacy workflow as a readable outline (default), a node list (every activity with its exits and where it is " +
        "reached from), a structural analysis, or a Mermaid flowchart.",
      inputSchema: {
        instance: instanceParam,
        workflow: workflowParam,
        version: versionParam,
        view: z.enum(["outline", "nodes", "analysis", "mermaid"]).optional().describe("Which view. Default outline."),
        flow_hints: z.boolean().optional().describe("Outline and nodes: annotate steps with the likely Flow Designer construct."),
        all_values: z.boolean().optional().describe("Outline and nodes: include settings left at their defaults."),
        full_scripts: z.boolean().optional().describe("Outline and nodes: print scripts in full (default: the first 25 lines)."),
      },
    },
    async ({ instance, workflow, version, view, flow_hints, all_values, full_scripts }) => {
      try {
        const data = await withConnectionRetry(instance, (sn) => new WorkflowManager(sn).exportWorkflow(workflow, { version: version ?? "current" }));
        const options = { allValues: all_values === true, flowHints: flow_hints === true, fullScripts: full_scripts === true };
        const body =
          view === "analysis" ? renderWorkflowAnalysis(data)
          : view === "nodes" ? renderWorkflowNodes(data, options)
          : view === "mermaid" ? renderWorkflowMermaid(data)
          : renderWorkflowOutline(data, options);
        return text([dataBlock(body)]);
      } catch (error) {
        return errorText("outline_workflow", error);
      }
    }
  );
}

export function registerExportWorkflowTool(server: McpServer): void {
  server.registerTool(
    "export_workflow",
    {
      annotations: annotationsFor("export_workflow"),
      title: "Export Workflow",
      description:
        "Export a legacy workflow version as one complete JSON document (now-sdk-ext/legacy-workflow@1): every activity with " +
        "its variables, the transitions and conditions. Read-only.",
      inputSchema: { instance: instanceParam, workflow: workflowParam, version: versionParam },
    },
    async ({ instance, workflow, version }) => {
      try {
        const data = await withConnectionRetry(instance, (sn) => new WorkflowManager(sn).exportWorkflow(workflow, { version: version ?? "current" }));
        return text([dataBlock(JSON.stringify(data, null, 2))]);
      } catch (error) {
        return errorText("export_workflow", error);
      }
    }
  );
}

export function registerConvertWorkflowTool(server: McpServer): void {
  server.registerTool(
    "convert_workflow",
    {
      annotations: annotationsFor("convert_workflow"),
      title: "Plan Workflow Conversion",
      description:
        "Plan the move of a legacy workflow to Flow Designer: how each activity maps to a flow step, what has to stay a script, " +
        "and a Fluent (now-sdk) skeleton for the flow, returned as text. Read-only: nothing is written to the instance or to " +
        "disk.",
      inputSchema: {
        instance: instanceParam,
        workflow: workflowParam,
        version: versionParam,
        include_fluent: z.boolean().optional().describe("Include the generated Fluent source files. Default true."),
        directory: z
          .string()
          .regex(/^[a-zA-Z0-9_./-]{1,200}$/)
          .refine((d) => !d.split("/").includes(".."), "no ..")
          .optional()
          .describe("Folder inside the app the skeleton is laid out for. Default src/fluent/flows."),
      },
    },
    async ({ instance, workflow, version, include_fluent, directory }) => {
      try {
        const data = await withConnectionRetry(instance, (sn) => new WorkflowManager(sn).exportWorkflow(workflow, { version: version ?? "current" }));
        const plan = planFlowConversion(data);
        const lines = [renderFlowPlan(plan)];
        if (include_fluent !== false) {
          for (const file of generateFluentFlow(plan, { directory: directory ?? "src/fluent/flows" })) {
            lines.push("", `--- ${clean(file.path)} ---`, file.content);
          }
        }
        return text([dataBlock(lines.join("\n"))]);
      } catch (error) {
        return errorText("convert_workflow", error);
      }
    }
  );
}

export function registerValidateWorkflowTool(server: McpServer): void {
  server.registerTool(
    "validate_workflow",
    {
      annotations: annotationsFor("validate_workflow"),
      title: "Validate Workflow",
      description:
        "Run the Workflow Editor's Validate Workflow on a version (by default your draft if you have one, else the published " +
        "version) and return its report, without publishing anything. The platform saves the report over that version's " +
        "previous one; the workflow itself is unchanged.",
      inputSchema: { instance: instanceParam, workflow: workflowParam, version: versionParam },
    },
    async ({ instance, workflow, version }) => {
      try {
        const report = await withConnectionRetry(instance, async (sn) => {
          const wm = new WorkflowManager(sn);
          return wm.validateWorkflow(await readableVersion(wm, workflow, version));
        });
        const lines = [
          ...(report.summary ? [`Summary: ${cleanMessage(report.summary)}`] : []),
          ...report.items.slice(0, 200).map((i) => `- [${clean(i.level)}] ${clean(i.type)}: ${cleanMessage(i.message)}${i.details ? ` (${cleanMessage(i.details)})` : ""}`),
          ...(report.items.length > 200 ? [`... (${report.items.length - 200} more)`] : []),
        ];
        return text([
          `Validation of version ${clean(report.versionSysId)}: ${report.valid ? "valid" : "has warnings or critical issues"}`,
          ...(lines.length ? [dataBlock(lines.join("\n"))] : []),
        ]);
      } catch (error) {
        return errorText("validate_workflow", error);
      }
    }
  );
}

export function registerListWorkflowActivityTypesTool(server: McpServer): void {
  server.registerTool(
    "list_workflow_activity_types",
    {
      annotations: annotationsFor("list_workflow_activity_types"),
      title: "List Workflow Activity Types",
      description:
        "List legacy workflow activity types, or describe one as this instance defines it (its variables, default " +
        "conditions, and optionally its implementation script or how published workflows configure it).",
      inputSchema: {
        instance: instanceParam,
        type: z.string().max(100).regex(/^[^\p{Cc}^]*$/u).optional().describe("An activity type name or sys_id to describe. Omit to list."),
        name: z.string().max(100).regex(/^[^\p{Cc}^]*$/u).optional().describe("Listing: name contains this text."),
        category: z.string().max(100).regex(/^[^\p{Cc}^]*$/u).optional().describe("Listing: category, e.g. Approvals, Timers, Utilities."),
        core_only: z.boolean().optional().describe("Listing: leave out Activity Designer and Orchestration activities."),
        include_script: z.boolean().optional().describe("Describing: include the implementation script."),
        usage_sample: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Describing: instead, show how up to this many published activities of the type are configured."),
      },
    },
    async ({ instance, type, name, category, core_only, include_script, usage_sample }) => {
      try {
        if (!type && (include_script || usage_sample)) throw new Error("The script and usage views describe one activity type: name the type.");
        if (include_script && usage_sample) throw new Error("The script and usage views are separate: ask for one at a time.");
        const body = await withConnectionRetry(instance, async (sn) => {
          const wm = new WorkflowManager(sn);
          if (!type) {
            const types = await wm.listActivityDefinitions({ name, category, includeDesigner: core_only !== true });
            return [`${types.length} activity type(s)`, ...types.map((t) => `- ${clean(t.name)} (${t.sysId}) [${clean(t.category)}] ${clean(t.sysClassName)}`)].join("\n");
          }
          if (usage_sample) return JSON.stringify(await wm.getActivityUsage(type, { sampleSize: usage_sample }), null, 2);
          return JSON.stringify(await wm.getActivityDefinition(type, { includeScript: include_script === true }), null, 2);
        });
        return text([dataBlock(body)]);
      } catch (error) {
        return errorText("list_workflow_activity_types", error);
      }
    }
  );
}
