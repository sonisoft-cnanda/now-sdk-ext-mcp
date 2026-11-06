import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

const mockWithConnectionRetry = jest.fn<(alias: any, op: any, options?: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: mockWithConnectionRetry }))

const dbg = {
  start: jest.fn<(...a: any[]) => Promise<any>>(), runTo: jest.fn<(...a: any[]) => Promise<any>>(), command: jest.fn<(...a: any[]) => Promise<any>>(),
  inspect: jest.fn<(...a: any[]) => Promise<any>>(), locations: jest.fn<(...a: any[]) => Promise<any>>(), getBreakpoints: jest.fn<(...a: any[]) => Promise<any>>(),
  setBreakpoints: jest.fn<(...a: any[]) => Promise<any>>(), clearBreakpoints: jest.fn<(...a: any[]) => Promise<any>>(), cancel: jest.fn<(...a: any[]) => Promise<any>>(),
  listSessions: jest.fn<(...a: any[]) => Promise<any>>(),
}
class FlowDebugError extends Error { constructor(public code: string, public detail?: any) { super(`Flow debugger: ${code}`) } }
class PolicyRefusal extends Error {}

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  FlowDebugger: jest.fn().mockImplementation(() => dbg),
  FlowDebugError,
  isPolicyRefusal: (e: unknown) => e instanceof PolicyRefusal,
  redactMessage: (m: string) => m.replace(/secret-\w+/g, '[redacted]'),
  // Modules imported alongside (working-set, metadata, logging).
  WorkingSetManager: jest.fn(), UpdateSetExporter: jest.fn(), WorkingSetError: class extends Error {}, UpdateSetExportError: class extends Error {},
  Logger: jest.fn().mockImplementation(() => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
  configureLogging: jest.fn(), redactValue: jest.fn((v: unknown) => v), flushLogs: jest.fn(() => Promise.resolve()),
}))

const tools = await import('../../../src/tools/flow-debug.js')

const CTX = 'a'.repeat(32), CHILD = 'b'.repeat(32), FLOW = 'c'.repeat(32)
const loc = (number: number, label: string, line = number * 10) => ({ line, step: { number, label, kind: 'action', uiUniqueIdentifier: `u${number}`, snapshotInstanceId: `s${number}` } })
const snap = (over: any = {}) => ({
  rootContextId: CTX, contextId: CTX, chain: [CTX], flowName: 'Create Task', state: 'PAUSED', rawState: 'PAUSED', pausedLines: [30],
  pausedAt: loc(3, 'Update Record'), flowInputs: {}, flowOutputs: {},
  steps: [
    { reportKey: 's1', step: loc(1, 'Create Record').step, state: 'COMPLETE', runTimeMs: 12, inputs: { table: { value: 'incident' } },
      outputs: { Record: { value: 'r', displayValue: 'x'.repeat(300) }, __action_status__: { value: 0 } } },
    { reportKey: 's3', step: loc(3, 'Update Record').step, state: 'WAITING', inputs: { password: { value: 'secret-abc' } }, outputs: {} },
  ],
  ...over,
})
const session = () => ({ contextId: CTX, flow: { sysId: FLOW, name: 'Create Task', type: 'flow', scope: 'x_app' }, locations: [loc(1, 'Create Record'), loc(3, 'Update Record')],
  breakpoints: [{ ...loc(3, 'Update Record'), verified: true }], snapshot: snap() })

let server: McpServer, client: Client
beforeEach(async () => {
  jest.clearAllMocks()
  mockWithConnectionRetry.mockImplementation(async (_a: any, op: any) => op({}))
  server = new McpServer({ name: 't', version: '1' })
  for (const [n, r] of Object.entries(tools)) if (n.startsWith('register')) (r as (s: McpServer) => void)(server)
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s)
  client = new Client({ name: 'c', version: '1' }); await client.connect(c)
})
afterEach(async () => { await client.close(); await server.close() })
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args })
  return { text: r.content[0].text as string, isError: r.isError === true }
}

describe('debug_flow_start', () => {
  it('starts once with inputs and breakpoints, waits 45 s by default, and shows the run fenced and redacted', async () => {
    dbg.start.mockResolvedValue(session())
    const { text, isError } = await call('debug_flow_start', { flow: 'x_app.create_task_copy', inputs: { table: 'incident' }, breakpoints: [3] })
    expect(isError).toBe(false)
    expect(dbg.start).toHaveBeenCalledWith({ flow: 'x_app.create_task_copy', inputs: { table: 'incident' }, breakpoints: [3], timeoutMs: 45_000 })
    expect(mockWithConnectionRetry.mock.calls[0][2]).toEqual({ retry: false })
    expect(text).toContain(`Debug run ${CTX} of flow ${FLOW} (x_app)`)
    expect(text).toContain('Debugging runs the flow for real')
    expect(text).toContain('- step 3 Update Record (line 30)')
    expect(text).toContain(`Run ${CTX}: PAUSED at line 30`)
    expect(text).toContain('Paused step 3 Update Record (WAITING)')
    expect(text).toContain('[redacted]')
    expect(text).not.toContain('secret-abc')
    expect(text).toMatch(/\[data [0-9a-f]{12}\] Debug run data below/)
    expect(text).toContain('End it with debug_flow_cancel')
  })

  it('refuses a reserved input name and a bad flow before calling', async () => {
    expect((await call('debug_flow_start', { flow: FLOW, inputs: JSON.parse('{"__proto__": 1}') })).isError).toBe(true)
    expect((await call('debug_flow_start', { flow: 'Create Task' })).isError).toBe(true)
    expect(dbg.start).not.toHaveBeenCalled()
  })

  it('explains a debugger refusal, and a run that may have started', async () => {
    dbg.start.mockRejectedValueOnce(new FlowDebugError('missing_input', { inputs: ['table'] }))
    const missing = await call('debug_flow_start', { flow: FLOW })
    expect(missing.text).toContain('flow debugger refused: missing_input')
    expect(missing.text).toContain('Detail: inputs table')
    dbg.start.mockRejectedValueOnce(new FlowDebugError('start_failed', { contextId: CTX, cancelled: false }))
    const failed = await call('debug_flow_start', { flow: FLOW })
    expect(failed.text).toContain(`context ${CTX}; cancelled false`)
    expect(failed.text).toContain('list_flow_debug_sessions')
    dbg.start.mockRejectedValueOnce(new Error('socket hang up'))
    expect((await call('debug_flow_start', { flow: FLOW })).text).toContain('The run may have moved before this failed')
    dbg.start.mockRejectedValueOnce(new PolicyRefusal('Running scripts or flows is not permitted'))
    const policy = await call('debug_flow_start', { flow: FLOW })
    expect(policy.text).toContain('refused by policy')
    expect(policy.text).not.toContain('may have moved')
  })
})

describe('debug_flow_run_to', () => {
  it('runs to a breakpoint and cancels by default', async () => {
    dbg.runTo.mockResolvedValue({ session: session(), snapshot: snap(), cancel: { contextId: CTX, before: 'PAUSED', after: 'CANCELLED', cancelled: true, alreadyEnded: false } })
    const { text } = await call('debug_flow_run_to', { flow: FLOW, breakpoints: [3] })
    expect(dbg.runTo).toHaveBeenCalledWith({ flow: FLOW, inputs: {}, breakpoints: [3], after: 'cancel', timeoutMs: 45_000 })
    expect(text).toContain('At the breakpoint:')
    expect(text).toContain(`Run ${CTX} cancelled (was PAUSED).`)
    expect(text).not.toContain('End it with debug_flow_cancel')
  })

  it('reports where a resumed run got to, and a stayed run as open', async () => {
    dbg.runTo.mockResolvedValueOnce({ session: session(), snapshot: snap(), final: snap({ state: 'COMPLETE', pausedAt: undefined }) })
    expect((await call('debug_flow_run_to', { flow: FLOW, breakpoints: [3], after: 'resume' })).text).toContain(`After resuming:\nRun ${CTX}: COMPLETE`)
    dbg.runTo.mockResolvedValueOnce({ session: session(), snapshot: snap() })
    expect((await call('debug_flow_run_to', { flow: FLOW, breakpoints: [3], after: 'stay' })).text).toContain('End it with debug_flow_cancel')
    expect((await call('debug_flow_run_to', { flow: FLOW, breakpoints: [] })).isError).toBe(true)
  })
})

describe('debug_flow_step', () => {
  it('maps each action to its command, never replayed', async () => {
    dbg.command.mockResolvedValue(snap({ state: 'COMPLETE', pausedAt: undefined }))
    for (const [action, command] of [[undefined, 'STEP_OVER'], ['into', 'STEP_INTO'], ['out', 'STEP_OUT'], ['resume', 'RESUME'], ['skip_all', 'SKIP_ALL']] as const) {
      await call('debug_flow_step', { context_id: CTX, ...(action ? { action } : {}), timeout_seconds: 10 })
      expect(dbg.command).toHaveBeenLastCalledWith(CTX, command, { timeoutMs: 10_000 })
    }
    expect(mockWithConnectionRetry.mock.calls.every((c) => c[2]?.retry === false)).toBe(true)
  })

  it('shows a child context and a timed-out wait', async () => {
    dbg.command.mockResolvedValue(snap({ contextId: CHILD, chain: [CTX, CHILD], state: 'RUNNING', timedOut: true, pausedAt: undefined }))
    const { text } = await call('debug_flow_step', { context_id: CTX, action: 'into' })
    expect(text).toContain(`in child subflow context ${CHILD} (depth 1) (still running when the wait timed out)`)
    expect(text).toContain('Still open')
  })
})

describe('debug_flow_inspect', () => {
  it('shows the snapshot, steps, locations and breakpoints, cutting long values unless full', async () => {
    dbg.inspect.mockResolvedValue(snap())
    const steps = await call('debug_flow_inspect', { context_id: CTX, view: 'steps' })
    expect(steps.text).toContain('(300 characters; full shows all)')
    expect(steps.text).not.toContain('__action_status__')
    const full = await call('debug_flow_inspect', { context_id: CTX, view: 'steps', step: 1, full: true })
    expect(full.text).toContain('__action_status__')
    expect(full.text).not.toContain('Update Record')
    expect((await call('debug_flow_inspect', { context_id: CTX, view: 'steps', step: 9 })).text).toContain('Step 9 has no data yet.')
    dbg.locations.mockResolvedValue([loc(1, 'Create Record')])
    expect((await call('debug_flow_inspect', { context_id: CTX, view: 'locations' })).text).toContain('- step 1 Create Record (line 10)')
    dbg.getBreakpoints.mockResolvedValue([])
    expect((await call('debug_flow_inspect', { context_id: CTX, view: 'breakpoints' })).text).toContain('No breakpoints.')
  })
})

describe('debug_flow_breakpoints', () => {
  it('sets, merges and clears, refusing an ambiguous change', async () => {
    dbg.setBreakpoints.mockImplementation(async (_c: any, refs: any) => refs.map((r: any) => (typeof r === 'number' ? { ...loc(r, `S${r}`), verified: true } : { line: r.line, verified: true })))
    expect((await call('debug_flow_breakpoints', { context_id: CTX, set: [2, 3] })).text).toContain('- step 3 S3')
    expect(dbg.setBreakpoints).toHaveBeenLastCalledWith(CTX, [2, 3])
    dbg.getBreakpoints.mockResolvedValue([{ ...loc(2, 'S2'), verified: true }, { line: 99, verified: true }])
    await call('debug_flow_breakpoints', { context_id: CTX, add: [4], remove: [2] })
    expect(dbg.setBreakpoints).toHaveBeenLastCalledWith(CTX, [{ line: 99 }, 4])
    dbg.getBreakpoints.mockResolvedValue([{ ...loc(2, 'S2'), verified: true }])
    expect((await call('debug_flow_breakpoints', { context_id: CTX, remove: [2] })).text).toContain('No breakpoints.')
    expect(dbg.clearBreakpoints).toHaveBeenCalledTimes(1)
    await call('debug_flow_breakpoints', { context_id: CTX, clear: true })
    expect(dbg.clearBreakpoints).toHaveBeenCalledTimes(2)
    expect((await call('debug_flow_breakpoints', { context_id: CTX, set: [2], clear: true })).isError).toBe(true)
    expect((await call('debug_flow_breakpoints', { context_id: CTX })).isError).toBe(true)
    dbg.setBreakpoints.mockRejectedValueOnce(new FlowDebugError('unknown_breakpoint', { validSteps: [1, 2, 3] }))
    expect((await call('debug_flow_breakpoints', { context_id: CTX, set: [9] })).text).toContain('valid steps 1, 2, 3')
  })
})

describe('debug_flow_cancel and list_flow_debug_sessions', () => {
  it('cancels, reports an ended run, and refuses a real flow run', async () => {
    dbg.cancel.mockResolvedValueOnce({ contextId: CTX, before: 'PAUSED', after: 'CANCELLED', cancelled: true, alreadyEnded: false })
    expect((await call('debug_flow_cancel', { context_id: CTX })).text).toBe(`Run ${CTX} cancelled (was PAUSED).`)
    dbg.cancel.mockResolvedValueOnce({ contextId: CTX, before: 'COMPLETE', after: 'COMPLETE', cancelled: false, alreadyEnded: true })
    expect((await call('debug_flow_cancel', { context_id: CTX })).text).toContain('had already ended (COMPLETE); nothing was sent')
    dbg.cancel.mockRejectedValueOnce(new FlowDebugError('not_a_debug_session'))
    expect((await call('debug_flow_cancel', { context_id: CTX })).text).toContain('will not be stepped or cancelled')
  })

  it('lists open runs', async () => {
    dbg.listSessions.mockResolvedValue([{ contextId: CTX, flowName: 'Create Task', flowSysId: FLOW, state: 'PAUSED', createdBy: 'admin', createdOn: '2026-11-06 21:00:00' }])
    const { text } = await call('list_flow_debug_sessions', { created_by: 'admin' })
    expect(dbg.listSessions).toHaveBeenCalledWith({ createdBy: 'admin', limit: 50 })
    expect(text).toContain(`- ${CTX} PAUSED since 2026-11-06 21:00:00 by admin: Create Task`)
    dbg.listSessions.mockResolvedValue([])
    expect((await call('list_flow_debug_sessions', {})).text).toBe('No open debug runs.')
  })
})
