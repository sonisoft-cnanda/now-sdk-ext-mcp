import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FlowDebugError,
  FlowDebugger,
  isPolicyRefusal,
  type FlowDebugBreakpoint,
  type FlowDebugCancelResult,
  type FlowDebugLocation,
  type FlowDebugSession,
  type FlowDebugSnapshot,
  type FlowDebugStepData,
  type FlowDebugStepRef,
  type FlowDebugValue,
} from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";
import { clean, cleanMessage, dataBlock, text } from "../common/tool-text.js";
import { instanceParam } from "./working-set.js";

/**
 * Workflow Studio's flow debugger (Test > Debug), as `nex flow debug start|run|step|resume|skip-all|break|inspect|
 * cancel|list` drive it. The debugger is stateless over REST: a run is addressed by its root context id, which
 * debug_flow_start returns, and list_flow_debug_sessions finds runs left open. So no session is held in this server.
 *
 * A debug run executes the flow for real and holds a flow context open while paused; every run must be ended, by
 * running it to the end or with debug_flow_cancel. Starting and stepping need execute (core refuses a start it could
 * not cancel); breakpoints and cancel need only write, so a run stays cancellable under NEX_POLICY_DENY=execute.
 * Calls that move a run are never replayed after a transport error: a step would run twice.
 */

const SYS_ID = /^[0-9a-f]{32}$/;
const VALUE_MAX = 200;
const WARNING = "Debugging runs the flow for real: records it creates or changes are kept.";

const contextParam = z.string().regex(SYS_ID).describe("The run's root context id, from debug_flow_start or list_flow_debug_sessions.");
const flowParam = z
  .string()
  .regex(/^([0-9a-f]{32}|[a-z0-9_]{1,80}\.[a-z0-9_]{1,200})$/, "a sys_id, or scope.internal_name")
  .describe("The flow or subflow: its sys_hub_flow sys_id, or scope.internal_name (e.g. x_app.create_task_copy).");
// Checked before zod builds its output object: assigning a __proto__ key there would set the object's prototype.
const inputsParam = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/, "an input name")
      .refine((k) => !["__proto__", "constructor", "prototype"].includes(k), "prohibited key"),
    z.unknown()
  )
  .optional()
  .describe(
    "Inputs by name. For a subflow, its declared inputs (checked before anything runs; an array for an array input is " +
      "sent as Workflow Studio sends it). For a flow, its trigger outputs (e.g. current, table_name)."
  );
const stepsParam = z.array(z.number().int().min(1).max(10_000)).min(1).max(50);
const LEFT_OPEN = "A client that gives up first leaves the run open: find it with list_flow_debug_sessions.";
const timeoutParam = z
  .number()
  .int()
  .min(1)
  .max(300)
  .optional()
  .describe(`Seconds to wait for the run to pause again or end. Default 45, under the 60-second request timeout many MCP clients use. ${LEFT_OPEN}`);
// Under the common 60 s client request timeout, so the answer arrives before the client gives up on it.
const DEFAULT_WAIT_S = 45;
// run_to waits more than once (start, the breakpoint, and with resume the end; a cancel then settles for up to
// ~18 s), so its budget is for the whole call and is split across the waits.
const DEFAULT_RUN_TO_S = 30;
const fullParam = z.boolean().optional().describe("Show values in full, and the engine's internal outputs (__action_status__ and the like).");

const REMEDIATION: Record<string, string> = {
  breakpoint_not_verified: "The debugger cannot stop there. Pick another step: debug_flow_inspect with view locations lists where it can stop.",
  cancel_failed: "The run is still open. Call debug_flow_cancel again, or end it from the flow context record in the instance.",
  context_not_found: "No flow context has that id. List open runs with list_flow_debug_sessions.",
  flow_not_found: "No flow or subflow matches. Pass its sys_id, or scope.internal_name (get_flow_definition shows both).",
  invalid_input: "Check the arguments: ids are 32-character sys_ids, steps are whole numbers from 1, inputs is an object.",
  missing_input: "Give a value for each mandatory input listed in the detail.",
  not_a_debug_session: "That context was not started by the debugger, so it will not be stepped or cancelled. Start one with debug_flow_start.",
  not_debuggable: "Only flows and subflows can be debugged. Run an action with execute_action instead.",
  not_paused: "The run is not paused. See where it is with debug_flow_inspect.",
  permission_denied: "This user cannot use the Workflow Studio debugger. It needs the flow_designer role (or admin).",
  release_unsupported: "This instance has no Workflow Studio debugger (its release does not offer Test > Debug).",
  start_failed: "The debugger did not start a run. If the detail says cancelled false, a run may be open: check list_flow_debug_sessions.",
  unexpected_response: "The debugger answered in an unexpected way. Check the run with debug_flow_inspect, and cancel it if it is open.",
  unknown_breakpoint: "That step cannot be a breakpoint. Valid steps are in the detail.",
  unknown_input: "The subflow does not declare the inputs in the detail. get_flow_definition lists its inputs.",
};

const cut = (value: string, full: boolean): string =>
  full || value.length <= VALUE_MAX ? value : `${value.slice(0, VALUE_MAX)}… (${value.length} characters; full shows all)`;

function where(location: FlowDebugLocation | undefined): string {
  if (!location) return "";
  const { step } = location;
  if (!step) return `line ${location.line}`;
  return step.number === undefined ? `${clean(step.label)} (line ${location.line})` : `step ${step.number} ${clean(step.label)}`;
}

function locationLines(locations: FlowDebugLocation[]): string[] {
  if (locations.length === 0) return ["No locations: the run has no steps the debugger can stop at."];
  // where() already names the line for a location without a step number.
  return ["Steps it can stop at:", ...locations.map((l) => `- ${where(l)}${l.step?.number === undefined ? "" : ` (line ${l.line})`}`)];
}

function breakpointLines(breakpoints: FlowDebugBreakpoint[]): string[] {
  if (breakpoints.length === 0) return ["No breakpoints."];
  return ["Breakpoints:", ...breakpoints.map((b) => `- ${where(b)}${b.verified ? "" : ` (not verified: ${cleanMessage(b.message ?? "")})`}`)];
}

function valueLines(title: string, values: Record<string, FlowDebugValue>, full: boolean): string[] {
  const names = Object.keys(values).filter((name) => full || !name.startsWith("__"));
  if (names.length === 0) return [`  ${title}: (none)`];
  return [
    `  ${title}:`,
    ...names.map((name) => {
      const { displayValue, value } = values[name];
      const shown = displayValue === undefined || displayValue === "" ? (JSON.stringify(value) ?? "") : displayValue;
      return `    ${clean(name)}: ${cut(clean(shown), full)}`;
    }),
  ];
}

function stepLines(step: FlowDebugStepData, full: boolean, title = "Step"): string[] {
  const label = step.step?.number === undefined ? clean(step.step?.label ?? step.reportKey) : `${step.step.number} ${clean(step.step.label)}`;
  return [`${title} ${label} (${clean(step.state)})`, ...valueLines("Inputs", step.inputs, full), ...valueLines("Outputs", step.outputs, full)];
}

/** The paused element's report: its own, or for a loop the latest of its `<id>.…` entries. */
function pausedStep(snapshot: FlowDebugSnapshot): FlowDebugStepData | undefined {
  const id = snapshot.pausedAt?.step?.snapshotInstanceId;
  if (!id) return undefined;
  return snapshot.steps.find((s) => s.reportKey === id) ?? [...snapshot.steps].reverse().find((s) => s.step?.snapshotInstanceId === id);
}

/** What to call next, for a run in this state. */
function hints(snapshot: FlowDebugSnapshot): string[] {
  const ctx = clean(snapshot.rootContextId);
  if (snapshot.state === "PAUSED") {
    return [`Next: debug_flow_step (over, into, out, resume or skip_all) or debug_flow_inspect on ${ctx}. End it with debug_flow_cancel.`];
  }
  if (snapshot.state === "RUNNING" || snapshot.state === "WAITING" || snapshot.state === "UNKNOWN") {
    return [`Still open: check it with debug_flow_inspect, or end it with debug_flow_cancel, on ${ctx}.`];
  }
  return [];
}

/** Where the run is: tool-written status lines, then the run's data (names, labels, values) fenced as data. */
function snapshotLines(snapshot: FlowDebugSnapshot, full: boolean, allSteps = false): string[] {
  const depth = snapshot.chain.length - 1;
  const state = snapshot.state === "PAUSED" ? `PAUSED at line ${snapshot.pausedLines.join(", ") || "?"}` : snapshot.state;
  const head = [
    `Run ${clean(snapshot.rootContextId)}: ${state}${depth > 0 ? ` in child subflow context ${clean(snapshot.contextId)} (depth ${depth})` : ""}` +
      `${snapshot.timedOut ? " (still running when the wait timed out)" : ""}`,
  ];
  const body = [`${clean(snapshot.flowName)}${snapshot.pausedAt ? `: paused at ${where(snapshot.pausedAt)}` : ""}`];
  if (snapshot.error) body.push(`Error: ${clean(snapshot.error)}`);
  for (const step of snapshot.steps) {
    const number = step.step?.number === undefined ? "-" : String(step.step.number);
    const time = step.runTimeMs === undefined ? "" : `, ${step.runTimeMs} ms`;
    const error = step.error && step.error !== "Success" ? ` ! ${clean(step.error)}` : "";
    body.push(`- ${number} ${clean(step.state)}${time}: ${clean(step.step?.label ?? step.reportKey)}${error}`);
  }
  if (allSteps) {
    // Every step's inputs and outputs: what run_to returns, since a cancelled run cannot be inspected afterwards.
    for (const step of snapshot.steps) body.push(...stepLines(step, full));
  } else {
    const paused = snapshot.state === "PAUSED" ? pausedStep(snapshot) : undefined;
    if (paused) body.push(...stepLines(paused, full, "Paused step"));
  }
  return [...head, dataBlock(body.join("\n"), "Debug run data", "without full")];
}

/** The run's flow, where it can stop and its breakpoints: instance text, so fenced. */
function flowLines(session: FlowDebugSession): string {
  return dataBlock(
    [`${clean(session.flow.name)} (${clean(session.flow.scope)})`, ...locationLines(session.locations), ...breakpointLines(session.breakpoints)].join("\n"),
    "Flow steps",
    "one view at a time"
  );
}

/** Core sets start's breakpoints only once the run has paused; say so when they were asked for and not set. */
function unsetBreakpoints(session: FlowDebugSession, requested: number[] | undefined): string[] {
  return requested?.length && session.breakpoints.length === 0
    ? [`Breakpoints were not set: the run had not paused (${session.snapshot.state}) when the wait ended.`]
    : [];
}

function sessionLines(session: FlowDebugSession, full: boolean, requested?: number[]): string[] {
  return [
    `Debug run ${clean(session.contextId)} of ${session.flow.type} ${clean(session.flow.sysId)}`,
    WARNING,
    flowLines(session),
    ...unsetBreakpoints(session, requested),
    ...snapshotLines(session.snapshot, full),
    ...hints(session.snapshot),
  ];
}

function cancelLine(result: FlowDebugCancelResult): string {
  if (result.alreadyEnded) return `Run ${clean(result.contextId)} had already ended (${clean(result.after)}); nothing was sent.`;
  return `Run ${clean(result.contextId)} ${result.cancelled ? "cancelled" : `ended as ${clean(result.after)}`} (was ${clean(result.before)}).`;
}

/**
 * A failure as text. A FlowDebugError carries a code, a detail and a remediation; a run that started and could not be
 * set up again is named so it can be found. `moved` marks a call that may have moved the run before it failed.
 */
function failure(action: string, error: unknown, moved: boolean, note?: string) {
  const lines: string[] = [];
  if (error instanceof FlowDebugError) {
    lines.push(`Error (${action}): flow debugger refused: ${error.code}`);
    const d = error.detail;
    if (d) {
      const parts = [
        d.contextId ? `context ${clean(d.contextId)}` : "",
        d.state ? `state ${clean(d.state)}` : "",
        d.status !== undefined ? `HTTP ${d.status}` : "",
        d.cancelled !== undefined ? `cancelled ${d.cancelled}` : "",
        d.inputs?.length ? `inputs ${d.inputs.map(clean).join(", ")}` : "",
        d.validSteps?.length ? `valid steps ${d.validSteps.join(", ")}` : "",
        d.serverMessage ? `server said: ${cleanMessage(d.serverMessage)}` : "",
      ].filter(Boolean);
      if (parts.length) lines.push(`Detail: ${parts.join("; ")}`);
    }
    lines.push(REMEDIATION[error.code] ?? "Check the run with debug_flow_inspect before retrying.");
  } else if (isPolicyRefusal(error)) {
    lines.push(`Error (${action}): refused by policy: ${cleanMessage((error as Error).message)}`);
  } else {
    lines.push(`Error (${action}): ${cleanMessage(error instanceof Error ? error.message : String(error))}`);
    if (moved) lines.push("The run may have moved before this failed: check it with debug_flow_inspect, or list_flow_debug_sessions.");
  }
  if (note) lines.push(note);
  return { ...text(lines), isError: true };
}

export function registerDebugFlowStartTool(server: McpServer): void {
  server.registerTool(
    "debug_flow_start",
    {
      annotations: annotationsFor("debug_flow_start"),
      title: "Start Flow Debug Run",
      description:
        "Start a Workflow Studio debug run (Test > Debug) of a flow or subflow and leave it paused before its first step. " +
        "The flow's current draft runs, for real: records it creates or changes are kept, so debug a copy (copy_flow) in a " +
        "scratch app. Returns the run's root context id, the steps it can stop at, and where it is. Continue with " +
        "debug_flow_step, and always end it: run it to the end, or debug_flow_cancel. debug_flow_run_to does all of this " +
        "in one call. Only when the user asked to debug.",
      inputSchema: {
        instance: instanceParam,
        flow: flowParam,
        inputs: inputsParam,
        breakpoints: stepsParam.optional().describe("Steps to break at, by the number Workflow Studio shows."),
        timeout_seconds: timeoutParam,
        full: fullParam,
      },
    },
    async ({ instance, flow, inputs, breakpoints, timeout_seconds, full }) => {
      try {
        const session = await withConnectionRetry(
          instance,
          (sn) =>
            new FlowDebugger(sn).start({
              flow,
              inputs: inputs ?? {},
              ...(breakpoints ? { breakpoints } : {}),
              timeoutMs: (timeout_seconds ?? DEFAULT_WAIT_S) * 1000,
            }),
          { retry: false }
        );
        return text(sessionLines(session, full === true, breakpoints));
      } catch (error) {
        return failure("debug_flow_start", error, true);
      }
    }
  );
}

export function registerDebugFlowRunToTool(server: McpServer): void {
  server.registerTool(
    "debug_flow_run_to",
    {
      annotations: annotationsFor("debug_flow_run_to"),
      title: "Debug Flow To Breakpoint",
      description:
        "Debug a flow or subflow to a breakpoint in one call: start it, run to the first of the breakpoints, report every " +
        "step's inputs and outputs there, then (by default) cancel it so nothing is left open. after resume lets it run on " +
        "to the end, ignoring the other breakpoints; after stay leaves it paused for debug_flow_step. The run is real: " +
        "records it creates or changes are kept. Only when the user asked to debug.",
      inputSchema: {
        instance: instanceParam,
        flow: flowParam,
        inputs: inputsParam,
        breakpoints: stepsParam.describe("Steps to break at, by the number Workflow Studio shows. The run stops at the first one reached."),
        after: z.enum(["cancel", "resume", "stay"]).optional().describe("After the breakpoint: cancel (default), resume to the end, or stay paused."),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(300)
          .optional()
          .describe(
            "Seconds for the whole call, split across its waits (start, the breakpoint, and with resume the end). Default 30, " +
              `so a cancel's settling still fits under a 60-second client timeout. ${LEFT_OPEN}`
          ),
        full: fullParam,
      },
    },
    async ({ instance, flow, inputs, breakpoints, after, timeout_seconds, full }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          (sn) =>
            new FlowDebugger(sn).runTo({
              flow,
              inputs: inputs ?? {},
              breakpoints: breakpoints as FlowDebugStepRef[],
              after: after ?? "cancel",
              timeoutMs: Math.floor(((timeout_seconds ?? DEFAULT_RUN_TO_S) * 1000) / (after === "resume" ? 3 : 2)),
            }),
          { retry: false }
        );
        // Core's snapshot is the run at the breakpoint, or where it ended if it never reached one.
        const at = result.snapshot.state === "PAUSED" && breakpoints.includes(result.snapshot.pausedAt?.step?.number ?? -1);
        const lines = [
          `Debug run ${clean(result.session.contextId)} of ${result.session.flow.type} ${clean(result.session.flow.sysId)}`,
          WARNING,
          ...unsetBreakpoints(result.session, breakpoints),
          at ? "At the breakpoint:" : "The run did not reach a breakpoint:",
          ...snapshotLines(result.snapshot, full === true, true),
        ];
        // When the run had already ended, core returns the same snapshot as final.
        if (result.final && result.final !== result.snapshot) {
          lines.push("After resuming:", ...snapshotLines(result.final, full === true), ...hints(result.final));
        } else if (!result.cancel) {
          lines.push(...hints(result.final ?? result.snapshot));
        }
        if (result.cancel) lines.push(cancelLine(result.cancel));
        return text(lines);
      } catch (error) {
        // runTo cancels the run when it fails after starting it (best effort).
        return failure(
          "debug_flow_run_to",
          error,
          true,
          isPolicyRefusal(error) ? undefined : "run_to cancels its run when it fails; confirm with list_flow_debug_sessions."
        );
      }
    }
  );
}

const COMMANDS = { over: "STEP_OVER", into: "STEP_INTO", out: "STEP_OUT", resume: "RESUME", skip_all: "SKIP_ALL" } as const;

export function registerDebugFlowStepTool(server: McpServer): void {
  server.registerTool(
    "debug_flow_step",
    {
      annotations: annotationsFor("debug_flow_step"),
      title: "Step Flow Debug Run",
      description:
        "Move a paused debug run and report where it is: over (run the paused step, stop at the next; default), into (enter " +
        "a subflow call, which runs in a child context that later calls apply to), out (run the rest of the current " +
        "subflow; at the top level, the rest of the run), resume (to the next breakpoint or the end), or skip_all (to the " +
        "end, ignoring breakpoints). The steps run for real.",
      inputSchema: {
        instance: instanceParam,
        context_id: contextParam,
        action: z.enum(["over", "into", "out", "resume", "skip_all"]).optional().describe("Default over."),
        timeout_seconds: timeoutParam,
        full: fullParam,
      },
    },
    async ({ instance, context_id, action, timeout_seconds, full }) => {
      try {
        const snapshot = await withConnectionRetry(
          instance,
          (sn) => new FlowDebugger(sn).command(context_id, COMMANDS[action ?? "over"], { timeoutMs: (timeout_seconds ?? DEFAULT_WAIT_S) * 1000 }),
          { retry: false }
        );
        return text([...snapshotLines(snapshot, full === true), ...hints(snapshot)]);
      } catch (error) {
        return failure("debug_flow_step", error, true);
      }
    }
  );
}

export function registerDebugFlowInspectTool(server: McpServer): void {
  server.registerTool(
    "debug_flow_inspect",
    {
      annotations: annotationsFor("debug_flow_inspect"),
      title: "Inspect Flow Debug Run",
      description:
        "Show a debug run without moving it: where it is (default), every step's runtime inputs and outputs (steps), where " +
        "it can stop (locations), or its breakpoints. Values are the run's real data; long ones are cut unless full.",
      inputSchema: {
        instance: instanceParam,
        context_id: contextParam,
        view: z.enum(["snapshot", "steps", "locations", "breakpoints"]).optional().describe("Default snapshot."),
        step: z.number().int().min(1).optional().describe("With view steps only: just this step's inputs and outputs."),
        full: fullParam,
      },
    },
    async ({ instance, context_id, view, step, full }) => {
      try {
        const lines = await withConnectionRetry(instance, async (sn) => {
          const dbg = new FlowDebugger(sn);
          if (view === "locations") return [dataBlock(locationLines(await dbg.locations(context_id)).join("\n"), "Flow steps", "one view at a time")];
          if (view === "breakpoints") return [dataBlock(breakpointLines(await dbg.getBreakpoints(context_id)).join("\n"), "Flow steps", "one view at a time")];
          const snapshot = await dbg.inspect(context_id);
          if (view !== "steps") return [...snapshotLines(snapshot, full === true), ...hints(snapshot)];
          const chosen = step === undefined ? snapshot.steps : snapshot.steps.filter((s) => s.step?.number === step);
          const body = chosen.length
            ? chosen.flatMap((s) => stepLines(s, full === true))
            : [step === undefined ? "No step has run yet." : `Step ${step} has no data yet.`];
          return [`Run ${snapshot.rootContextId}: ${snapshot.state}`, dataBlock(body.join("\n"), "Debug run data", "one step, without full")];
        });
        return text(lines);
      } catch (error) {
        return failure("debug_flow_inspect", error, false);
      }
    }
  );
}

/**
 * The breakpoints to send after adding `add` and removing `remove` (step numbers), as nex's mergeBreakpoints does.
 * Held ones are kept by line, so a breakpoint without a step number (an inner action step) is not dropped.
 */
export function mergeBreakpoints(held: FlowDebugBreakpoint[], add: number[], remove: number[]): FlowDebugStepRef[] {
  const kept: FlowDebugStepRef[] = held
    .filter((b) => b.step?.number === undefined || !remove.includes(b.step.number))
    .map((b) => ({ line: b.line }));
  const heldNumbers = new Set(held.map((b) => b.step?.number));
  return [...kept, ...add.filter((n) => !heldNumbers.has(n))];
}

export function registerDebugFlowBreakpointsTool(server: McpServer): void {
  server.registerTool(
    "debug_flow_breakpoints",
    {
      annotations: annotationsFor("debug_flow_breakpoints"),
      title: "Set Flow Debug Breakpoints",
      description:
        "Change a debug run's breakpoints, by the step numbers Workflow Studio shows: replace them (set), add or remove " +
        "some, or clear them all. Each step is looked up in the debugger's own list of places it can stop; one it cannot " +
        "stop at is refused with the valid steps. remove matches by step number, so a breakpoint on an inner action step " +
        "(which has none) is only removed by set or clear. While the run is in a subflow, this applies to the subflow. To " +
        "list them, use debug_flow_inspect with view breakpoints.",
      inputSchema: {
        instance: instanceParam,
        context_id: contextParam,
        set: stepsParam.optional().describe("Replace the breakpoints with these steps."),
        add: stepsParam.optional().describe("Add breakpoints at these steps, keeping the others."),
        remove: stepsParam.optional().describe("Remove the breakpoints at these steps."),
        clear: z.boolean().optional().describe("Remove every breakpoint."),
      },
    },
    async ({ instance, context_id, set, add, remove, clear }) => {
      const modes = [set !== undefined, clear === true, add !== undefined || remove !== undefined].filter(Boolean).length;
      if (add?.some((step) => remove?.includes(step))) {
        return { ...text(["Error (debug_flow_breakpoints): a step cannot be both added and removed. Nothing was sent."]), isError: true };
      }
      if (modes !== 1) {
        return { ...text(["Error (debug_flow_breakpoints): give exactly one change: replace, add and/or remove, or clear. Nothing was sent."]), isError: true };
      }
      try {
        const breakpoints = await withConnectionRetry(instance, async (sn) => {
          const dbg = new FlowDebugger(sn);
          if (set) return dbg.setBreakpoints(context_id, set);
          if (!clear) {
            // Read, merge, write, as nex does (two concurrent changes can overwrite each other). Nothing left means clear.
            const refs = mergeBreakpoints(await dbg.getBreakpoints(context_id), add ?? [], remove ?? []);
            if (refs.length) return dbg.setBreakpoints(context_id, refs);
          }
          await dbg.clearBreakpoints(context_id);
          return [];
        });
        return text([dataBlock(breakpointLines(breakpoints).join("\n"), "Flow steps", "one view at a time")]);
      } catch (error) {
        return failure("debug_flow_breakpoints", error, false);
      }
    }
  );
}

export function registerDebugFlowCancelTool(server: McpServer): void {
  server.registerTool(
    "debug_flow_cancel",
    {
      annotations: annotationsFor("debug_flow_cancel"),
      title: "Cancel Flow Debug Run",
      description:
        "End a debug run, and any subflow it stepped into, then read it back. Safe to repeat. It refuses a flow context the " +
        "debugger did not start, so it cannot end a real flow run. Needs only write, so it works under NEX_POLICY_DENY=execute.",
      inputSchema: { instance: instanceParam, context_id: contextParam },
    },
    async ({ instance, context_id }) => {
      try {
        const result = await withConnectionRetry(instance, (sn) => new FlowDebugger(sn).cancel(context_id));
        return text([cancelLine(result)]);
      } catch (error) {
        return failure("debug_flow_cancel", error, false);
      }
    }
  );
}

export function registerListFlowDebugSessionsTool(server: McpServer): void {
  server.registerTool(
    "list_flow_debug_sessions",
    {
      annotations: annotationsFor("list_flow_debug_sessions"),
      title: "List Flow Debug Runs",
      description:
        "List debug runs still open on the instance (paused, waiting or running), newest first. A run left paused holds a " +
        "flow context open: find it here and end it with debug_flow_cancel.",
      inputSchema: {
        instance: instanceParam,
        created_by: z.string().regex(/^[a-z0-9_.@+-]{1,100}$/i, "a user name").optional().describe("Only runs started by this user name."),
        limit: z.number().int().min(1).max(500).optional().describe("At most this many. Default 50."),
      },
    },
    async ({ instance, created_by, limit }) => {
      try {
        const sessions = await withConnectionRetry(instance, (sn) =>
          new FlowDebugger(sn).listSessions({ ...(created_by ? { createdBy: created_by } : {}), limit: limit ?? 50 })
        );
        if (sessions.length === 0) return text(["No open debug runs."]);
        const rows = sessions.map(
          (s) => `- ${clean(s.contextId)} ${clean(s.state)} since ${clean(s.createdOn)} by ${clean(s.createdBy)}: ${clean(s.flowName)}`
        );
        return text([
          `${sessions.length} open debug run(s), newest first:`,
          dataBlock(rows.join("\n"), "Open debug runs", "a lower limit or created_by"),
          "End one with debug_flow_cancel.",
        ]);
      } catch (error) {
        return failure("list_flow_debug_sessions", error, false);
      }
    }
  );
}
