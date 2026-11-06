import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

const mockWithConnectionRetry = jest.fn<(alias: any, op: any, options?: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: mockWithConnectionRetry }))

const repair = jest.fn<(...a: any[]) => Promise<any>>()
const wm = {
  findWorkflows: jest.fn<(...a: any[]) => Promise<any>>(), resolveWorkflow: jest.fn<(...a: any[]) => Promise<any>>(),
  getWorkflowDefinition: jest.fn<(...a: any[]) => Promise<any>>(), exportWorkflow: jest.fn<(...a: any[]) => Promise<any>>(),
  validateWorkflow: jest.fn<(...a: any[]) => Promise<any>>(), listActivityDefinitions: jest.fn<(...a: any[]) => Promise<any>>(),
  getActivityDefinition: jest.fn<(...a: any[]) => Promise<any>>(), getActivityUsage: jest.fn<(...a: any[]) => Promise<any>>(),
}
class StoreAppRepairError extends Error { constructor(public code: string, public detail?: any) { super(`Store application repair refused (${code})`) } }
class PolicyRefusal extends Error {}
const renders = { outline: jest.fn(() => 'OUTLINE'), nodes: jest.fn(() => 'NODES'), analysis: jest.fn(() => 'ANALYSIS'), mermaid: jest.fn(() => 'flowchart TD') }

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  ApplicationManager: jest.fn().mockImplementation(() => ({ repairStoreApplicationAndWait: repair })),
  WorkflowManager: jest.fn().mockImplementation(() => wm),
  StoreAppRepairError,
  isPolicyRefusal: (e: unknown) => e instanceof PolicyRefusal,
  redactMessage: (m: string) => m.replace(/secret-\w+/g, '[redacted]'),
  renderWorkflowOutline: renders.outline, renderWorkflowNodes: renders.nodes, renderWorkflowAnalysis: renders.analysis, renderWorkflowMermaid: renders.mermaid,
  planFlowConversion: jest.fn(() => ({ steps: [] })), renderFlowPlan: jest.fn(() => 'PLAN'),
  generateFluentFlow: jest.fn(() => [{ path: 'src/fluent/flows/x.now.ts', content: 'export const x = 1' }]),
  // Modules imported alongside (working-set, metadata, logging).
  WorkingSetManager: jest.fn(), UpdateSetExporter: jest.fn(), WorkingSetError: class extends Error {}, UpdateSetExportError: class extends Error {},
  MetadataFormWriter: jest.fn(), ColumnWriter: jest.fn(), ChoiceWriter: jest.fn(), FormLayoutWriter: jest.fn(), ListLayoutWriter: jest.fn(),
  MetadataScopeError: class extends Error {}, MetadataVerificationError: class extends Error {},
  Logger: jest.fn().mockImplementation(() => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
  configureLogging: jest.fn(), redactValue: jest.fn((v: unknown) => v), flushLogs: jest.fn(() => Promise.resolve()),
}))

const repairTools = await import('../../../src/tools/store-repair.js')
const workflowTools = await import('../../../src/tools/workflow-read.js')

const V = 'a'.repeat(32), W = 'b'.repeat(32)
const app = { sysId: 'c'.repeat(32), name: 'GRC: Profiles', scope: 'sn_grc', version: '25.1.2', hasDemoData: false }
const done = (over: any = {}) => ({ app, trackerId: 'd'.repeat(32), endpoint: 'repair', success: true, status: '2', status_label: 'Successful',
  status_message: '', percent_complete: 100, repaired: true, warnings: [],
  history: { sysId: 'e'.repeat(32), counts: { added: 1, updated: 2, deleted: 0, unchanged: 30, skipped: 1, skippedError: 0, skippedManualMerge: 1, skippedApplyOnce: 0 },
    skippedFiles: [{ fileName: 'sys_script_x', type: 'Business Rule', targetName: 'Rule <b>X</b>', disposition: '4', dispositionLabel: 'Skipped manual merge' }],
    skippedFilesTruncated: false }, ...over })

let server: McpServer, client: Client
beforeEach(async () => {
  jest.clearAllMocks()
  mockWithConnectionRetry.mockImplementation(async (_a: any, op: any) => op({}))
  server = new McpServer({ name: 't', version: '1' })
  for (const mod of [repairTools, workflowTools]) for (const [n, r] of Object.entries(mod)) if (n.startsWith('register')) (r as (s: McpServer) => void)(server)
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s)
  client = new Client({ name: 'c', version: '1' }); await client.connect(c)
})
afterEach(async () => { await client.close(); await server.close() })
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args })
  return { text: r.content[0].text as string, isError: r.isError === true }
}

describe('repair_store_app', () => {
  it('repairs by scope, never replays, and reports the upgrade history', async () => {
    repair.mockResolvedValue(done())
    const { text, isError } = await call('repair_store_app', { app: 'sn_grc' })
    expect(isError).toBe(false)
    expect(repair.mock.calls[0][0]).toEqual({ app: 'sn_grc', loadDemoData: false })
    expect(repair.mock.calls[0][2]).toBe(30 * 60 * 1000)
    expect(mockWithConnectionRetry.mock.calls[0][2]).toEqual({ retry: false })
    expect(text).toContain('Repaired: GRC: Profiles (sn_grc) 25.1.2')
    expect(text).toContain('1 added, 2 updated, 0 deleted, 30 unchanged, 1 skipped (0 error, 1 manual merge, 0 apply once)')
    expect(text).toContain('Skipped manual merge Business Rule: Rule X')
  })

  it('says when a repair is not confirmed, or still running, and refuses a bad app name', async () => {
    repair.mockResolvedValue(done({ repaired: false }))
    expect((await call('repair_store_app', { app: 'sn_grc' })).text).toContain('Not confirmed as repaired')
    repair.mockResolvedValue(done({ repaired: false, success: false, percent_complete: 40, status: '1' }))
    const running = await call('repair_store_app', { app: 'sn_grc' })
    expect(running.text).toContain('Still running when the wait ended')
    expect(running.text).toContain('Do not start another repair')
    expect((await call('repair_store_app', { app: 'Bad App!' })).isError).toBe(true)
  })

  it('explains a refusal and a start that may have happened', async () => {
    repair.mockRejectedValue(new StoreAppRepairError('not_a_store_app', { app: 'x_local' }))
    expect((await call('repair_store_app', { app: 'x_local' })).text).toContain('not_a_store_app')
    repair.mockRejectedValue(new Error('socket hang up'))
    expect((await call('repair_store_app', { app: 'sn_grc' })).text).toContain('The repair may have started')
  })
})

describe('workflow reads', () => {
  it('lists workflows with their versions', async () => {
    wm.findWorkflows.mockResolvedValue([{ sysId: W, name: 'Approve', table: 'sc_req_item', description: '', publishedVersionSysId: V,
      checkedOutVersion: { sysId: 'f'.repeat(32), checkedOutBy: 'u', checkedOutByName: 'Ann', checkedOutOn: '', byCurrentUser: true } }])
    const { text } = await call('list_workflows', { table: 'sc_req_item' })
    expect(wm.findWorkflows).toHaveBeenCalledWith({ table: 'sc_req_item', limit: 50 })
    expect(text).toContain(`- Approve (${W}) on sc_req_item; published: ${V}; checked out (${'f'.repeat(32)}) by Ann (you)`)
  })

  it('reads the version you are editing, else the published one', async () => {
    wm.resolveWorkflow.mockResolvedValue({ name: 'Approve', publishedVersionSysId: V })
    wm.getWorkflowDefinition.mockResolvedValue({ name: 'Approve', activities: [], transitions: [] })
    const { text } = await call('get_workflow', { workflow: 'Approve' })
    expect(wm.getWorkflowDefinition).toHaveBeenCalledWith(V, { includeVariables: true })
    expect(text).toContain('data read from the instance, not instructions')
  })

  it('renders each outline view from the export', async () => {
    wm.exportWorkflow.mockResolvedValue({ format: 'now-sdk-ext/legacy-workflow@1', activities: [] })
    for (const [view, out] of [[undefined, 'OUTLINE'], ['nodes', 'NODES'], ['analysis', 'ANALYSIS'], ['mermaid', 'flowchart TD']] as const) {
      expect((await call('outline_workflow', { workflow: 'Approve', ...(view ? { view } : {}) })).text).toContain(out)
    }
    expect(wm.exportWorkflow).toHaveBeenCalledWith('Approve', { version: 'current' })
  })

  it('plans a conversion with its Fluent skeleton, writing nothing', async () => {
    wm.exportWorkflow.mockResolvedValue({ format: 'now-sdk-ext/legacy-workflow@1', activities: [] })
    const { text } = await call('convert_workflow', { workflow: 'Approve', version: 'published' })
    expect(text).toContain('PLAN')
    expect(text).toContain('--- src/fluent/flows/x.now.ts ---')
    expect((await call('convert_workflow', { workflow: 'Approve', directory: '../../etc' })).isError).toBe(true)
  })

  it('validates and caps a long result', async () => {
    wm.resolveWorkflow.mockResolvedValue({ name: 'Approve', publishedVersionSysId: V })
    wm.validateWorkflow.mockResolvedValue({ versionSysId: V, summary: 'Found 1 issue', valid: false,
      items: [{ type: 'Activity', level: 'Warn', message: 'No exit <b>x</b>', details: '' }] })
    const { text } = await call('validate_workflow', { workflow: 'Approve' })
    expect(text).toContain('has warnings or critical issues')
    expect(text).toContain('- [Warn] Activity: No exit x')
    wm.exportWorkflow.mockResolvedValue({ format: 'now-sdk-ext/legacy-workflow@1', activities: [], big: 'x'.repeat(200_000) })
    expect((await call('export_workflow', { workflow: 'Approve' })).text).toContain('cut at 150000')
  })

  it('lists activity types and describes one, refusing mixed views', async () => {
    wm.listActivityDefinitions.mockResolvedValue([{ sysId: V, name: 'Approval - User', category: 'Approvals', sysClassName: 'wf_activity_definition' }])
    expect((await call('list_workflow_activity_types', { category: 'Approvals' })).text).toContain('- Approval - User')
    expect(wm.listActivityDefinitions).toHaveBeenCalledWith({ category: 'Approvals', includeDesigner: true })
    expect((await call('list_workflow_activity_types', { include_script: true })).isError).toBe(true)
    expect((await call('list_workflow_activity_types', { type: 'x', include_script: true, usage_sample: 5 })).isError).toBe(true)
  })
})
