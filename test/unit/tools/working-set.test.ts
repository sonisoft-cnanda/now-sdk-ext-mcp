import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockWithConnectionRetry = jest.fn<(alias: any, op: any, options?: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: mockWithConnectionRetry }))

const ws = {
  useUpdateSet: jest.fn<(...a: any[]) => Promise<any>>(),
  restoreWorkingSet: jest.fn<(...a: any[]) => Promise<any>>(),
  completeUpdateSet: jest.fn<(...a: any[]) => Promise<any>>(),
  moveCapture: jest.fn<(...a: any[]) => Promise<any>>(),
}
const exportUpdateSet = jest.fn<(...a: any[]) => Promise<any>>()
class WorkingSetError extends Error { constructor(public code: string, public detail?: any) { super(`Update set operation failed: ${code}`) } }
class UpdateSetExportError extends Error { constructor(public code: string, public detail?: any) { super(`Update set export failed: ${code}`) } }
class PolicyRefusal extends Error {}

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  WorkingSetManager: jest.fn().mockImplementation(() => ws),
  UpdateSetExporter: jest.fn().mockImplementation(() => ({ exportUpdateSet })),
  UpdateSetManager: jest.fn().mockImplementation(() => ({})),
  WorkingSetError, UpdateSetExportError,
  isPolicyRefusal: (e: unknown) => e instanceof PolicyRefusal,
  redactMessage: (m: string) => m,
  // updateset.ts pulls in progress and logging, which log through core.
  Logger: jest.fn().mockImplementation(() => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
  configureLogging: jest.fn(),
  redactValue: jest.fn((v: unknown) => v),
  flushLogs: jest.fn(() => Promise.resolve()),
}))

const tools = await import('../../../src/tools/working-set.js')
const { registerSetCurrentUpdateSetTool } = await import('../../../src/tools/updateset.js')

const SET = 'c'.repeat(32), OTHER = 'd'.repeat(32), APP = 'a'.repeat(32), CAP = 'e'.repeat(32)
const summary = (sysId: string, state = 'in progress') => ({ sysId, name: `Set ${sysId[0]}`, state, application: APP, isDefault: false })

let server: McpServer, client: Client, dir: string
beforeEach(async () => {
  jest.clearAllMocks()
  mockWithConnectionRetry.mockImplementation(async (_a: any, op: any) => op({}))
  dir = mkdtempSync(join(tmpdir(), 'mcp-export-'))
  server = new McpServer({ name: 't', version: '1' })
  for (const r of [registerSetCurrentUpdateSetTool, tools.registerRestoreUpdateSetTool, tools.registerCompleteUpdateSetTool,
    tools.registerMoveUpdateSetCaptureTool, tools.registerExportUpdateSetTool]) r(server)
  const [c, s] = InMemoryTransport.createLinkedPair()
  await server.connect(s)
  client = new Client({ name: 'c', version: '1' })
  await client.connect(c)
})
afterEach(async () => { await client.close(); await server.close(); rmSync(dir, { recursive: true, force: true }) })

const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args })
  return { text: r.content[0].text as string, isError: r.isError === true }
}
const options = () => mockWithConnectionRetry.mock.calls.at(-1)![2]

describe('set_current_update_set', () => {
  it('uses the working-set path, never replays, and reports the previous set for restore', async () => {
    ws.useUpdateSet.mockResolvedValue({ previous: { application: 'global', updateSet: OTHER }, current: { application: APP, updateSet: SET }, updateSet: summary(SET) })
    const { text, isError } = await call('set_current_update_set', { sys_id: SET, name: 'ignored' })
    expect(isError).toBe(false)
    expect(ws.useUpdateSet).toHaveBeenCalledWith(SET)
    expect(options()).toEqual({ retry: false })
    expect(text).toContain(`Working set changed (read back): Set c (${SET})`)
    expect(text).toContain(`Previous working set: application global, update set ${OTHER}`)
  })

  it('explains a refused Default set and a working set that did not read back', async () => {
    ws.useUpdateSet.mockRejectedValue(new WorkingSetError('default_update_set', { updateSet: SET }))
    let r = await call('set_current_update_set', { sys_id: SET })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('default_update_set')
    expect(r.text).toContain('Create a set in the application')
    ws.useUpdateSet.mockRejectedValue(new WorkingSetError('working_set_not_applied', { previous: { application: 'global', updateSet: OTHER } }))
    r = await call('set_current_update_set', { sys_id: SET })
    expect(r.text).toContain(`restore it with restore_update_set`)
  })

  it('requires a sys_id', async () => {
    expect((await call('set_current_update_set', { name: 'x' })).isError).toBe(true)
    expect(ws.useUpdateSet).not.toHaveBeenCalled()
  })
})

describe('restore, complete and move', () => {
  it('restores, and says when the Default stood in', async () => {
    ws.restoreWorkingSet.mockResolvedValue({ restored: { application: APP, updateSet: OTHER }, fallback: 'application_default' })
    const { text } = await call('restore_update_set', { application: APP, update_set: SET })
    expect(ws.restoreWorkingSet).toHaveBeenCalledWith({ application: APP, updateSet: SET })
    expect(text).toContain("the application's Default set is current instead")
    expect((await call('restore_update_set', { application: 'x_app', update_set: SET })).isError).toBe(true)
  })

  it('completes with the reviewed count, and explains a count mismatch', async () => {
    ws.completeUpdateSet.mockResolvedValue(summary(SET, 'complete'))
    let r = await call('complete_update_set', { sys_id: SET, expected_captures: 3 })
    expect(ws.completeUpdateSet).toHaveBeenCalledWith(SET, { expectedCaptures: 3 })
    expect(r.text).toContain('state: complete')
    ws.completeUpdateSet.mockRejectedValue(new WorkingSetError('capture_count_mismatch', { expected: 3, actual: 4 }))
    r = await call('complete_update_set', { sys_id: SET, expected_captures: 3 })
    expect(r.text).toContain('Detail: expected: 3; actual: 4')
  })

  it('moves one capture with a plain reason, and refuses markup in the reason', async () => {
    ws.moveCapture.mockResolvedValue({ capture: CAP, name: 'sys_script_include_x', application: APP, from: summary(OTHER), to: summary(SET) })
    const r = await call('move_update_set_capture', { capture: CAP, source_set: OTHER, target_set: SET, reason: 'Belongs to FEAT-12' })
    expect(ws.moveCapture).toHaveBeenCalledWith({ capture: CAP, sourceSet: OTHER, targetSet: SET, reason: 'Belongs to FEAT-12' })
    expect(r.text).toContain(`To: Set c (${SET})`)
    expect((await call('move_update_set_capture', { capture: CAP, source_set: OTHER, target_set: SET, reason: '<b>x</b>' })).isError).toBe(true)
  })

  it('tells the model a write that failed in transit may have landed', async () => {
    ws.completeUpdateSet.mockRejectedValue(new Error('socket hang up'))
    expect((await call('complete_update_set', { sys_id: SET, expected_captures: 1 })).text).toContain('may have been applied')
  })
})

describe('export_update_set', () => {
  const result = { xml: '<unload>secret payload</unload>', source: 'local', kind: 'single',
    updateSet: { sysId: SET, name: 'Set c', state: 'complete', application: APP },
    sets: [{ sysId: SET, name: 'Set c', state: 'complete', records: 2 }], excluded: [], recordCount: 2,
    cleanup: { temporarySysId: OTHER, removedBy: 'platform' }, messages: [] }

  it('writes the file 0600 and never returns the XML', async () => {
    exportUpdateSet.mockResolvedValue(result)
    const output = join(dir, 'set.xml')
    const { text, isError } = await call('export_update_set', { sys_id: SET, output })
    expect(isError).toBe(false)
    expect(readFileSync(output, 'utf8')).toBe(result.xml)
    expect(statSync(output).mode & 0o777).toBe(0o600)
    expect(text).not.toContain('secret payload')
    expect(text).toContain('Records: 2')
    expect(text).toContain(`Temporary copy ${OTHER} removed by platform`)
    expect(exportUpdateSet).toHaveBeenCalledWith(SET, { includeIncomplete: false })
    expect(options()).toEqual({ retry: false })
    expect(readdirSync(dir)).toEqual(['set.xml'])
  })

  it('refuses to overwrite, or a missing directory, before copying anything on the instance', async () => {
    const output = join(dir, 'set.xml')
    writeFileSync(output, 'keep')
    let r = await call('export_update_set', { sys_id: SET, output })
    expect(r.text).toContain('output_exists')
    r = await call('export_update_set', { sys_id: SET, output: join(dir, 'missing', 'x.xml') })
    expect(r.text).toContain('output_invalid')
    expect(exportUpdateSet).not.toHaveBeenCalled()
    expect(readFileSync(output, 'utf8')).toBe('keep')
  })

  it('replaces only when asked, and explains an incomplete set', async () => {
    exportUpdateSet.mockResolvedValue(result)
    const output = join(dir, 'set.xml')
    writeFileSync(output, 'old')
    await call('export_update_set', { sys_id: SET, output, replace: true })
    expect(readFileSync(output, 'utf8')).toBe(result.xml)
    exportUpdateSet.mockRejectedValue(new UpdateSetExportError('update_set_incomplete', { state: 'in progress' }))
    const r = await call('export_update_set', { sys_id: SET, output: join(dir, 'b.xml') })
    expect(r.text).toContain('update_set_incomplete')
    expect(r.text).toContain('The platform exports only Complete sets')
    expect(r.text).not.toContain('may have been applied')
  })
})
