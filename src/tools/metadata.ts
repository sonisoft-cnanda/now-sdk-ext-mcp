import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ChoiceWriter,
  ColumnWriter,
  FormLayoutWriter,
  ListLayoutWriter,
  MetadataFormWriter,
  MetadataScopeError,
  MetadataVerificationError,
  isPolicyRefusal,
  redactMessage,
  type CaptureReport,
  type Choice,
  type MetadataScopeRef,
  type StoreCustomizationOptions,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";
import { instanceParam } from "./working-set.js";

/**
 * Application metadata written through the platform's forms, as `nex metadata` does: core's writers check the
 * application (scope), refuse protected and platform-schema records, post the form in the named update set, and
 * read back both the record and its capture. Writes are not replayed after a transport error (retry: false): the
 * first attempt may have landed.
 */

const NO_RETRY = { retry: false };

// Names core accepts. Stated here so the model sees them before a round trip.
const IDENT = /^[a-z0-9_]{1,80}$/;
const SYS_ID = /^[0-9a-f]{32}$/;
const NO_CONTROL = /^[^\p{Cc}]*$/u;

// Values come from the instance: one line each, no control characters (markup stripped from free text).
const clean = (text: string | undefined): string => (text ?? "").replace(/\p{Cc}/gu, " ");
const cleanMessage = (text: string): string =>
  redactMessage(text).replace(/<[^>]*>/g, "[omitted]").replace(/<[^>]*$/, "[omitted]").replace(/\p{Cc}/gu, " ");

function text(lines: string[]) {
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

/** Where a write goes: the record's application and an In progress update set of it. */
const targetParams = {
  scope: z
    .string()
    .regex(IDENT)
    .optional()
    .describe('The record\'s application: its scope name (e.g. "x_acme_app"), or "global". Give this or scope_id.'),
  scope_id: z.string().regex(SYS_ID).optional().describe("The record's application by sys_scope sys_id, instead of scope."),
  update_set: z
    .string()
    .regex(SYS_ID)
    .describe(
      "sys_id of an In progress update set of that application (create_update_set). The capture is verified there; " +
        "for columns and layouts it must also be the working set (set_current_update_set)."
    ),
  acknowledge_upgrade_skip: z
    .boolean()
    .optional()
    .describe(
      "Only for an installed Store application, and only after the user has reviewed the change: upgrades of that " +
        "application then skip this file until the customization is reviewed."
    ),
};

type TargetArgs = { scope?: string; scope_id?: string; update_set: string; acknowledge_upgrade_skip?: boolean };

class ToolInputError extends Error {}

function target(args: TargetArgs): { scope: MetadataScopeRef; updateSet: string; storeCustomization?: StoreCustomizationOptions } {
  if (args.scope && args.scope_id) throw new ToolInputError("Give the application once: a scope name or a scope sys_id, not both.");
  if (!args.scope && !args.scope_id) throw new ToolInputError("Name the record's application: a scope name, \"global\", or a scope sys_id.");
  const scope: MetadataScopeRef = args.scope_id ? { sysId: args.scope_id } : args.scope === "global" ? "global" : { scope: args.scope! };
  return {
    scope,
    updateSet: args.update_set,
    ...(args.acknowledge_upgrade_skip ? { storeCustomization: { acknowledgeUpgradeSkip: true as const } } : {}),
  };
}

/** Form field values: text, numbers, booleans, null, lists of text, or a duration. */
const valueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z
    .object({
      days: z.number().min(0).optional(),
      hours: z.number().min(0).optional(),
      minutes: z.number().min(0).optional(),
      seconds: z.number().min(0).optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, "a duration needs at least one part"),
]);
// The key is checked before zod builds its output object: assigning a __proto__ key there would set the object's prototype.
const valuesSchema = z.record(
  z
    .string()
    .regex(/^[a-z0-9_]{1,80}$/, "a lowercase column name")
    .refine((k) => !["__proto__", "constructor", "prototype"].includes(k), "prohibited key"),
  valueSchema
);

function captureLines(capture: CaptureReport | undefined): string[] {
  if (!capture) return [];
  const lines = [`Capture: ${clean(capture.action)} in ${clean(capture.updateSetName)} (${clean(capture.updateSetSysId)})`];
  if (capture.updateName) lines.push(`Update name: ${clean(capture.updateName)}`);
  if (capture.currentUpdateSet?.switched) {
    lines.push(`The user's current update set changed during the write (now ${clean(capture.currentUpdateSet.after)}): check it.`);
  }
  if (capture.customization) {
    lines.push("Store application file: upgrades now skip it until the customization is reviewed.");
  }
  return lines;
}

const REMEDIATION: Record<string, string> = {
  choice_ambiguous: "The list has more than one choice with that value in this language. Change them in the UI.",
  choice_in_use:
    "Records hold this value. Prefer set_choice with inactive, which keeps its label and hides it from new selections. " +
    "Removing it anyway leaves those records with a value that has no choice; ask the user first.",
  choice_list_inherited:
    "The column is defined on a parent table (named) and this table has no choice list of its own, so it shows the " +
    "parent's list. Change that table's list; a list of its own here would replace it on this table.",
  choice_not_found: "The list has no choice with that value in this language. Read it with get_choice_list.",
  choice_unchanged: "The choice already has those values; nothing was posted.",
  column_exists:
    "The table, or a table it extends, already has a column of that name. Choose another name (the name includes the platform's prefix).",
  column_has_data:
    "Rows hold a value in this column (counted); removing it deletes those values here and wherever the DELETE is " +
    "committed. Ask the user before acknowledging the data loss.",
  column_has_dependents:
    "The platform will also delete the onChange client scripts and UI policy actions that name this column (counted), " +
    "each captured as a DELETE. Read them first (sys_script_client and sys_ui_policy_action for the table and field) and " +
    "ask the user before acknowledging those deletes.",
  column_not_deletable:
    "The platform does not allow this column to be deleted: only a u_ column, or a scoped application's own column, can be. " +
    "A vendor column cannot be removed.",
  column_not_found: "The table and the tables it extends have no column of that name. Check the name, prefix included (u_ in Global).",
  column_referenced:
    "A client script or UI policy action of another application names this column, and the platform would delete it with " +
    "the column. Remove or change it in its own application first.",
  confirmation_required: "The confirmation must repeat the target exactly.",
  domain_not_supported:
    "The list or the user is outside the global domain. A save would create a new list in the session's domain and leave " +
    "this one unchanged: change it in the List Layout UI from the right domain.",
  elevation_required: "Access controls are changed with the ACL tools (create_acl, update_acl, ...), not as metadata.",
  field_not_supported:
    "The field named is not on the form (or not offered by the List Layout page) for this table and view, or cannot be written there.",
  form_redirected: "The form redirected instead of loading: the table may not support form writes, or the session lacks access.",
  protected_record: "The vendor protected this file. It cannot be changed; create a new record instead.",
  scope_mismatch:
    "The record belongs to another application (for a choice: the list, or the column when the table has no list yet). " +
    "Use that application with an update set of it; get_choice_list shows a list's application.",
  section_not_supported:
    "The section holds an annotation, chart or embedded list, which this save cannot write back. Change it in the Form " +
    "Layout UI; never drop those elements from the list.",
  store_scope:
    "This is an installed Store application. Changing its files makes upgrades skip them: stop and ask the user to review " +
    "the change and decide; record the customization in the update set description.",
  table_not_supported:
    "The table (or the referenced table) does not exist, or is one of the platform's own schema tables (update sets, " +
    "scopes, dictionary), or extends one. Access controls are changed with the ACL tools.",
  update_set_not_current: "Make the update set the working set first with set_current_update_set, and restore the previous one afterwards.",
  update_set_required: "Name an In progress update set of the record's application (create_update_set).",
  invalid_input: "A value failed validation (named in the detail): check its format and limits.",
};

/** Identifiers and counts only; capped, so a large detail object cannot flood the result. */
function detailLine(detail: object | undefined): string[] {
  if (!detail) return [];
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${clean(typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 300)}`);
  return parts.length ? [`Detail: ${parts.join("; ")}`] : [];
}

export function metadataErrorText(action: string, error: unknown) {
  const lines: string[] = [];
  if (error instanceof ToolInputError) {
    lines.push(`Error (${action}): ${error.message}`);
  } else if (isPolicyRefusal(error)) {
    lines.push(`Error (${action}): refused by policy: ${cleanMessage((error as Error).message)}`);
  } else if (error instanceof MetadataScopeError) {
    lines.push(`Error (${action}): ${error.code}`, ...detailLine(error.detail));
    if (REMEDIATION[error.code]) lines.push(REMEDIATION[error.code]);
  } else if (error instanceof MetadataVerificationError) {
    lines.push(`Error (${action}): ${error.code}: the write could not be verified${error.writeAttempted ? " (it was attempted)" : ""}.`);
    if (error.sysId) lines.push(`Record: ${clean(error.table)} ${clean(error.sysId)}`);
    for (const message of error.messages) lines.push(`Instance said: ${cleanMessage(message)}`);
    lines.push(...captureLines(error.capture as CaptureReport | undefined));
    if (error.writeAttempted) {
      lines.push("The record can exist after a failed verification: read the record and its capture before retrying or cleaning up.");
    }
  } else {
    lines.push(`Error (${action}): ${cleanMessage(error instanceof Error ? error.message : String(error))}`);
    if (!action.startsWith("get_")) {
      lines.push("The change may have been applied before this failed: read the record back before retrying.");
    }
  }
  return { ...text(lines), isError: true };
}

const recordParams = {
  instance: instanceParam,
  table: z.string().regex(IDENT).describe("The metadata table, e.g. sys_script_include, sys_ui_action, sys_properties."),
  ...targetParams,
  view: z.string().regex(IDENT).optional().describe("The form view to load. The default view when omitted."),
};

const writeParams = {
  fields: valuesSchema
    .optional()
    .describe(
      "Field values by column name: text, numbers, booleans, null, lists of text (glide lists), or a duration " +
        "({days, hours, minutes, seconds}). Dot-walked names are not supported; fields not on the form are refused."
    ),
  variables: valuesSchema.optional().describe("Variable values by element name (for records with a variables column)."),
  variable_field: z.string().regex(IDENT).optional().describe("The variables column, when the table has more than one."),
  initial_query: z
    .string()
    .regex(/^[a-z0-9_]+=[^^=\p{Cc}]*(\^[a-z0-9_]+=[^^=\p{Cc}]*)*$/u, "literal equality terms field=value joined by ^")
    .optional()
    .describe("Insert only: equality terms the new form starts from (sysparm_query), e.g. collection=incident^type=1."),
};

const SCOPE_NOTE =
  "Writes through the record's form in the named application and update set, then reads back the record and its capture. " +
  "Refuses protected files, the platform's own schema tables, and access controls (use the ACL tools).";

function resultLines(heading: string, result: { table: string; sysId: string; action: string; scope: { scope: string; sysId: string }; capture: CaptureReport; messages: string[] }) {
  return [
    heading,
    `Record: ${clean(result.table)} ${clean(result.sysId)} (${clean(result.action)})`,
    `Application: ${clean(result.scope.scope)} (${clean(result.scope.sysId)})`,
    ...captureLines(result.capture),
    ...result.messages.map((m) => `Instance said: ${cleanMessage(m)}`),
  ];
}

export function registerInsertMetadataRecordTool(server: McpServer): void {
  server.registerTool(
    "insert_metadata_record",
    {
      annotations: annotationsFor("insert_metadata_record"),
      title: "Insert Metadata Record",
      description: "Insert application metadata (a script include, business rule, UI action, property, ...). " + SCOPE_NOTE,
      inputSchema: { ...recordParams, ...writeParams },
    },
    async (args) => {
      try {
        const where = target(args);
        if (!args.fields && !args.variables && !args.initial_query) throw new ToolInputError("Supply fields, variables, or an initial query.");
        if (args.variable_field && !args.variables) throw new ToolInputError("A variables column needs variables.");
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new MetadataFormWriter(sn).insert(args.table, {
              ...where,
              ...(args.view ? { view: args.view } : {}),
              ...(args.fields ? { fields: args.fields } : {}),
              ...(args.variables ? { variables: args.variables } : {}),
              ...(args.variable_field ? { variableField: args.variable_field } : {}),
              ...(args.initial_query ? { initialQuery: args.initial_query } : {}),
            }),
          NO_RETRY
        );
        return text(resultLines("Inserted and verified.", result));
      } catch (error) {
        return metadataErrorText("insert_metadata_record", error);
      }
    }
  );
}

export function registerUpdateMetadataRecordTool(server: McpServer): void {
  server.registerTool(
    "update_metadata_record",
    {
      annotations: annotationsFor("update_metadata_record"),
      title: "Update Metadata Record",
      description: "Change fields of application metadata. " + SCOPE_NOTE,
      inputSchema: {
        ...recordParams,
        sys_id: z.string().regex(SYS_ID).describe("The record's sys_id."),
        fields: writeParams.fields,
        variables: writeParams.variables,
        variable_field: writeParams.variable_field,
      },
    },
    async (args) => {
      try {
        const where = target(args);
        if (!args.fields && !args.variables) throw new ToolInputError("Supply fields or variables to change.");
        if (args.variable_field && !args.variables) throw new ToolInputError("A variables column needs variables.");
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new MetadataFormWriter(sn).update(args.table, args.sys_id, {
              ...where,
              ...(args.view ? { view: args.view } : {}),
              ...(args.fields ? { fields: args.fields } : {}),
              ...(args.variables ? { variables: args.variables } : {}),
              ...(args.variable_field ? { variableField: args.variable_field } : {}),
            }),
          NO_RETRY
        );
        return text(resultLines("Updated and verified.", result));
      } catch (error) {
        return metadataErrorText("update_metadata_record", error);
      }
    }
  );
}

export function registerDeleteMetadataRecordTool(server: McpServer): void {
  server.registerTool(
    "delete_metadata_record",
    {
      annotations: annotationsFor("delete_metadata_record"),
      title: "Delete Metadata Record",
      description:
        "Delete application metadata through the platform's own Delete, captured as a DELETE in the named update set and " +
        "read back. Only when the user asked for the delete; deleting a record that other instances already have removes it " +
        "there too when the set is committed. " + SCOPE_NOTE,
      inputSchema: {
        ...recordParams,
        sys_id: z.string().regex(SYS_ID).describe("The record's sys_id."),
        confirm_table: z.string().regex(IDENT).describe("Repeat the table exactly."),
        confirm_sys_id: z.string().regex(SYS_ID).describe("Repeat the sys_id exactly."),
      },
    },
    async (args) => {
      try {
        const where = target(args);
        if (args.confirm_table !== args.table || args.confirm_sys_id !== args.sys_id) {
          throw new ToolInputError("The confirmation must repeat the table and sys_id exactly.");
        }
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new MetadataFormWriter(sn).delete(args.table, args.sys_id, {
              ...where,
              ...(args.view ? { view: args.view } : {}),
              confirm: { table: args.confirm_table, sysId: args.confirm_sys_id },
            }),
          NO_RETRY
        );
        return text(resultLines("Deleted and verified.", result));
      } catch (error) {
        return metadataErrorText("delete_metadata_record", error);
      }
    }
  );
}

export function registerAddTableColumnTool(server: McpServer): void {
  server.registerTool(
    "add_table_column",
    {
      annotations: annotationsFor("add_table_column"),
      title: "Add Table Column",
      description:
        "Add a column to a table, as the Columns related list does, with its Field Label and form layout captured and " +
        "verified. The update set must be the working set (set_current_update_set): the platform captures schema changes " +
        "only into the current set. The platform's prefix (u_ in Global, <scope>_ on another application's table) is added when missing.",
      inputSchema: {
        instance: instanceParam,
        table: z.string().regex(IDENT).describe("The table."),
        column: z.string().regex(IDENT).describe("The column name, lower case."),
        label: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[^<>\p{Cc}]*$/u, "plain text, no < or >")
          .describe("The column label."),
        type: z
          .string()
          .regex(IDENT)
          .optional()
          .describe("A sys_glide_object name: string (default), integer, boolean, glide_date_time, reference, glide_list, ..."),
        max_length: z.number().int().min(1).max(65000).optional().describe("Maximum length, for string types."),
        reference: z.string().regex(IDENT).optional().describe("The referenced table: required for reference, optional for glide_list."),
        ...targetParams,
      },
    },
    async (args) => {
      try {
        const where = target(args);
        const type = args.type ?? "string";
        if (args.reference !== undefined && type !== "reference" && type !== "glide_list") {
          throw new ToolInputError("A referenced table is only for type reference or glide_list.");
        }
        if (args.reference === undefined && type === "reference") throw new ToolInputError("Type reference needs the referenced table.");
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new ColumnWriter(sn).addColumn(args.table, {
              ...where,
              column: args.column,
              label: args.label,
              type,
              ...(args.max_length !== undefined ? { maxLength: args.max_length } : {}),
              ...(args.reference !== undefined ? { reference: args.reference } : {}),
            }),
          NO_RETRY
        );
        return text([
          `Column added and verified: ${clean(result.table)}.${clean(result.column)} (${clean(result.type)}), label ${clean(result.label)}`,
          `Dictionary record: ${clean(result.sysId)}`,
          `Application: ${clean(result.scope.scope)} (${clean(result.scope.sysId)})`,
          ...(result.formSections.length ? [`Added to form sections: ${result.formSections.map(clean).join(", ")}`] : []),
          `Captures: ${result.captures.map(clean).join(", ")}`,
          ...captureLines(result.capture),
          ...result.messages.map((m) => `Instance said: ${cleanMessage(m)}`),
        ]);
      } catch (error) {
        return metadataErrorText("add_table_column", error);
      }
    }
  );
}

export function registerRemoveTableColumnTool(server: McpServer): void {
  server.registerTool(
    "remove_table_column",
    {
      annotations: annotationsFor("remove_table_column"),
      title: "Remove Table Column",
      description:
        "Remove a column from a table (the platform's Delete on its dictionary record), with every DELETE capture verified in " +
        "the named update set. It deletes the column's data here and wherever the set is committed: only when the user asked. " +
        "Refused while rows hold values, or while client scripts or UI policy actions name it, unless those are acknowledged.",
      inputSchema: {
        instance: instanceParam,
        table: z.string().regex(IDENT).describe("The table."),
        column: z.string().regex(IDENT).describe("The column name, prefix included (u_ in Global)."),
        confirm: z.string().describe("Type <table>.<column> exactly, to confirm the removal."),
        acknowledge_data_loss: z
          .boolean()
          .optional()
          .describe("Rows hold values in the column and the user agreed they are deleted with it."),
        acknowledge_dependent_deletes: z
          .boolean()
          .optional()
          .describe("The user agreed the platform also deletes the client scripts and UI policy actions that name the column."),
        ...targetParams,
      },
    },
    async (args) => {
      try {
        const where = target(args);
        if (args.confirm !== `${args.table}.${args.column}`) throw new ToolInputError("The confirmation must name the table and column, as <table>.<column>.");
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new ColumnWriter(sn).removeColumn(args.table, args.column, {
              ...where,
              confirm: { table: args.table, column: args.column },
              ...(args.acknowledge_data_loss ? { acknowledgeDataLoss: true } : {}),
              ...(args.acknowledge_dependent_deletes ? { acknowledgeDependentDeletes: true } : {}),
            }),
          NO_RETRY
        );
        const deleted = [...result.deleted.labels, ...result.deleted.clientScripts, ...result.deleted.uiPolicyActions];
        const left = result.leftovers;
        return text([
          `Column removed and verified: ${clean(result.table)}.${clean(result.column)} (dictionary ${clean(result.sysId)})`,
          `Rows that held a value: ${result.records}`,
          ...(deleted.length ? [`Deleted with it: ${deleted.map(clean).join(", ")}`] : []),
          `DELETE captures: ${result.captures.map(clean).join(", ")}`,
          ...(result.createdInThisSet
            ? ["The column was created in this set, so its capture became the DELETE: shipping this set still carries a DELETE."]
            : []),
          ...(left.choices || left.formElements.length || left.listElements.length
            ? [`Left behind by the platform: ${left.choices} choice(s), ${left.formElements.length} form element(s), ${left.listElements.length} list element(s).`]
            : []),
          ...captureLines(result.capture),
          ...result.messages.map((m) => `Instance said: ${cleanMessage(m)}`),
        ]);
      } catch (error) {
        return metadataErrorText("remove_table_column", error);
      }
    }
  );
}

const choiceLine = (c: Choice) =>
  `- ${clean(c.value)}: ${clean(c.label)}${c.sequence !== undefined ? ` (sequence ${c.sequence})` : ""}` +
  `${c.inactive ? " INACTIVE" : ""}${c.dependentValue ? ` [depends on ${clean(c.dependentValue)}]` : ""}${c.hint ? ` hint: ${clean(c.hint)}` : ""}`;

const choiceParams = {
  instance: instanceParam,
  table: z.string().regex(IDENT).describe("The table."),
  column: z.string().regex(IDENT).describe("The column, prefix included (u_ in Global)."),
  language: z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/i).optional().describe("Choice language; en when omitted."),
};
const choiceValue = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[^^\p{Cc}]*$/u, "no ^ or control characters")
  .refine((v) => !/javascript:/i.test(v), "no javascript:");

export function registerGetChoiceListTool(server: McpServer): void {
  server.registerTool(
    "get_choice_list",
    {
      annotations: annotationsFor("get_choice_list"),
      title: "Get Choice List",
      description: "Read a column's choice list in one language, with the list's application (the one to write it in) and capture name.",
      inputSchema: choiceParams,
    },
    async ({ instance, table, column, language }) => {
      try {
        const list = await withConnectionRetry(instance, (sn) =>
          new ChoiceWriter(sn).getChoices(table, column, language ? { language } : {})
        );
        return text([
          `Choice list ${clean(list.table)}.${clean(list.element)} (${clean(list.language)}): ${list.choices.length} choice(s)`,
          `Column defined on ${clean(list.column.table)}; type ${clean(list.column.type)}; choice mode ${clean(list.column.choice) || "none"}`,
          list.choiceSet
            ? `List application: ${clean(list.choiceSet.scope)} (capture ${clean(list.choiceSet.updateName)})`
            : `No list of its own on this table; the column's application is ${clean(list.column.scope)}.`,
          ...list.choices.map(choiceLine),
        ]);
      } catch (error) {
        return metadataErrorText("get_choice_list", error);
      }
    }
  );
}

export function registerSetChoiceTool(server: McpServer): void {
  server.registerTool(
    "set_choice",
    {
      annotations: annotationsFor("set_choice"),
      title: "Set Choice",
      description:
        "Add a choice to a column's list, or change one (label, sequence, hint, inactive), in the list's application and the " +
        "named update set; the list's capture is verified there. Inactivating keeps the label and hides it from new selections.",
      inputSchema: {
        ...choiceParams,
        value: choiceValue.describe("The stored value; it identifies the choice in the list."),
        label: z.string().max(100).regex(NO_CONTROL).optional().describe("The label. Required to add a choice."),
        sequence: z.number().int().min(-2147483647).max(2147483647).optional().describe("Position in the list."),
        inactive: z.boolean().optional().describe("Inactivate (true) or reactivate (false)."),
        hint: z.string().max(255).regex(NO_CONTROL).optional().describe("Hint shown for the choice."),
        ...targetParams,
      },
    },
    async (args) => {
      try {
        const where = target(args);
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new ChoiceWriter(sn).setChoice(args.table, args.column, {
              ...where,
              value: args.value,
              ...(args.language ? { language: args.language } : {}),
              ...(args.label !== undefined ? { label: args.label } : {}),
              ...(args.sequence !== undefined ? { sequence: args.sequence } : {}),
              ...(args.inactive !== undefined ? { inactive: args.inactive } : {}),
              ...(args.hint !== undefined ? { hint: args.hint } : {}),
            }),
          NO_RETRY
        );
        return text([
          `Choice ${clean(result.value)} ${result.action === "insert" ? "added" : "changed"} and verified on ${clean(result.table)}.${clean(result.element)} (${clean(result.language)}).`,
          ...(result.choice ? [`Now: ${choiceLine(result.choice).slice(2)}`] : []),
          ...(result.previous ? [`Before: ${choiceLine(result.previous).slice(2)}`] : []),
          ...(result.choiceSet?.created ? ["The table had no list of its own: the save created one, which now replaces the parent's list here."] : []),
          ...captureLines(result.capture),
          ...result.messages.map((m) => `Instance said: ${cleanMessage(m)}`),
        ]);
      } catch (error) {
        return metadataErrorText("set_choice", error);
      }
    }
  );
}

export function registerRemoveChoiceTool(server: McpServer): void {
  server.registerTool(
    "remove_choice",
    {
      annotations: annotationsFor("remove_choice"),
      title: "Remove Choice",
      description:
        "Remove a choice from a column's list, captured in the named update set. Refused while records hold the value: " +
        "prefer set_choice with inactive, and remove anyway only when the user asked.",
      inputSchema: {
        ...choiceParams,
        value: choiceValue.describe("The stored value of the choice to remove."),
        confirm_in_use: z.boolean().optional().describe("The user agreed to remove it although records hold the value."),
        ...targetParams,
      },
    },
    async (args) => {
      try {
        const where = target(args);
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new ChoiceWriter(sn).removeChoice(args.table, args.column, {
              ...where,
              value: args.value,
              ...(args.language ? { language: args.language } : {}),
              ...(args.confirm_in_use ? { confirmInUse: true } : {}),
            }),
          NO_RETRY
        );
        return text([
          `Choice ${clean(result.value)} removed and verified from ${clean(result.table)}.${clean(result.element)} (${clean(result.language)}).`,
          ...(result.inUse ? [`Records still holding the value: ${result.inUse}`] : []),
          `Choices left: ${result.choices.length}`,
          ...captureLines(result.capture),
          ...result.messages.map((m) => `Instance said: ${cleanMessage(m)}`),
        ]);
      } catch (error) {
        return metadataErrorText("remove_choice", error);
      }
    }
  );
}

const ELEMENT = /^([a-z0-9_]{1,80}|\.begin_split|\.split|\.end_split|\.formatter\.[0-9a-f]{32})$/;

export function registerGetFormLayoutTool(server: McpServer): void {
  server.registerTool(
    "get_form_layout",
    {
      annotations: annotationsFor("get_form_layout"),
      title: "Get Form Layout",
      description:
        "Read one form section's layout (sys_ui_section) in order: field names, .begin_split / .split / .end_split, and " +
        ".formatter.<sys_id>. Find sections with query_table on sys_ui_section (name = table, view).",
      inputSchema: { instance: instanceParam, section: z.string().regex(SYS_ID).describe("The sys_ui_section sys_id.") },
    },
    async ({ instance, section }) => {
      try {
        const layout = await withConnectionRetry(instance, (sn) => new FormLayoutWriter(sn).getFormLayout(section));
        return text([
          `Form section ${clean(layout.section)}: ${clean(layout.table)}, view ${clean(layout.view) || "Default"}, caption ${clean(layout.caption) || "(main)"}`,
          `Application: ${clean(layout.scope)}`,
          `Elements (${layout.elements.length}): ${layout.elements.map(clean).join(", ")}`,
        ]);
      } catch (error) {
        return metadataErrorText("get_form_layout", error);
      }
    }
  );
}

export function registerSetFormLayoutTool(server: McpServer): void {
  server.registerTool(
    "set_form_layout",
    {
      annotations: annotationsFor("set_form_layout"),
      title: "Set Form Layout",
      description:
        "Replace one form section's layout with the whole new element list, as the Form Layout page saves it, captured and " +
        "read back. Read it first with get_form_layout and send every element to keep. The update set must be the working " +
        "set. Refused for sections holding annotations, charts or embedded lists.",
      inputSchema: {
        instance: instanceParam,
        section: z.string().regex(SYS_ID).describe("The sys_ui_section sys_id."),
        elements: z
          .array(z.string().regex(ELEMENT, "a field name, .begin_split, .split, .end_split or .formatter.<sys_id>"))
          .min(1)
          .max(500)
          .describe("The whole new layout, in order."),
        ...targetParams,
      },
    },
    async (args) => {
      try {
        const where = target(args);
        const result = await withConnectionRetry(
          args.instance,
          (sn) => new FormLayoutWriter(sn).setFormLayout(args.section, { ...where, elements: args.elements }),
          NO_RETRY
        );
        return text([
          `Form layout saved and read back: section ${clean(result.section)} (${clean(result.table)}, view ${clean(result.view) || "Default"})`,
          `Now: ${result.elements.map(clean).join(", ")}`,
          `Before (to restore): ${result.previousElements.map(clean).join(", ")}`,
          ...captureLines(result.capture),
        ]);
      } catch (error) {
        return metadataErrorText("set_form_layout", error);
      }
    }
  );
}

export function registerGetListLayoutTool(server: McpServer): void {
  server.registerTool(
    "get_list_layout",
    {
      annotations: annotationsFor("get_list_layout"),
      title: "Get List Layout",
      description: "Read a table's list columns (sys_ui_list) for a view, in order; dot-walked columns as field.field.",
      inputSchema: {
        instance: instanceParam,
        table: z.string().regex(IDENT).describe("The table."),
        view: z.string().regex(IDENT).optional().describe("The view; the Default view when omitted."),
      },
    },
    async ({ instance, table, view }) => {
      try {
        const layout = await withConnectionRetry(instance, (sn) => new ListLayoutWriter(sn).getListLayout(table, view));
        return text([
          `List ${clean(layout.table)}, view ${clean(layout.view) || "Default"}: ${layout.exists ? "its own list" : "no list of its own (the parent's or the default applies)"}`,
          ...(layout.sysId ? [`List record: ${clean(layout.sysId)}; application ${clean(layout.scope)}`] : []),
          `Columns (${layout.columns.length}): ${layout.columns.map(clean).join(", ")}`,
        ]);
      } catch (error) {
        return metadataErrorText("get_list_layout", error);
      }
    }
  );
}

export function registerSetListLayoutTool(server: McpServer): void {
  server.registerTool(
    "set_list_layout",
    {
      annotations: annotationsFor("set_list_layout"),
      title: "Set List Layout",
      description:
        "Replace a table's list columns for a view with the whole new column list, as the List Layout page saves it, captured " +
        "and read back. Read it first with get_list_layout. The update set must be the working set.",
      inputSchema: {
        instance: instanceParam,
        table: z.string().regex(IDENT).describe("The table."),
        view: z.string().regex(IDENT).optional().describe("The view; the Default view when omitted."),
        columns: z
          .array(z.string().regex(/^[a-z0-9_]{1,80}(\.[a-z0-9_]{1,80}){0,3}$/, "a field name, dot-walked as field.field"))
          .min(1)
          .max(200)
          .describe("The whole new column list, in order."),
        ...targetParams,
      },
    },
    async (args) => {
      try {
        const where = target(args);
        const result = await withConnectionRetry(
          args.instance,
          (sn) =>
            new ListLayoutWriter(sn).setListLayout(args.table, {
              ...where,
              columns: args.columns,
              ...(args.view ? { view: args.view } : {}),
            }),
          NO_RETRY
        );
        return text([
          `List layout saved and read back: ${clean(result.table)}, view ${clean(result.view) || "Default"} (list ${clean(result.sysId)})`,
          ...(result.created ? ["The table had no list of its own for this view: the save created one."] : []),
          `Now: ${result.columns.map(clean).join(", ")}`,
          ...(result.previousColumns.length ? [`Before (to restore): ${result.previousColumns.map(clean).join(", ")}`] : []),
          ...captureLines(result.capture),
        ]);
      } catch (error) {
        return metadataErrorText("set_list_layout", error);
      }
    }
  );
}
