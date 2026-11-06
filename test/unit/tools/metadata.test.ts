import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

const mockWithConnectionRetry = jest.fn<(alias: any, op: any, options?: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: mockWithConnectionRetry }))

const form = { insert: jest.fn<(...a: any[]) => Promise<any>>(), update: jest.fn<(...a: any[]) => Promise<any>>(), delete: jest.fn<(...a: any[]) => Promise<any>>() }
const columns = { addColumn: jest.fn<(...a: any[]) => Promise<any>>(), removeColumn: jest.fn<(...a: any[]) => Promise<any>>() }
const choices = { getChoices: jest.fn<(...a: any[]) => Promise<any>>(), setChoice: jest.fn<(...a: any[]) => Promise<any>>(), removeChoice: jest.fn<(...a: any[]) => Promise<any>>() }
const formLayout = { getFormLayout: jest.fn<(...a: any[]) => Promise<any>>(), setFormLayout: jest.fn<(...a: any[]) => Promise<any>>() }
const listLayout = { getListLayout: jest.fn<(...a: any[]) => Promise<any>>(), setListLayout: jest.fn<(...a: any[]) => Promise<any>>() }
class MetadataScopeError extends Error { constructor(public code: string, public detail?: any) { super(code) } }
// Same argument order as core's: code, table, sysId, capture, messages, writeAttempted.
class MetadataVerificationError extends Error {
  constructor(public code: string, public table: string, public sysId: string, public capture: any, public messages: string[], public writeAttempted: boolean) { super(code) }
}
class PolicyRefusal extends Error {}

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  MetadataFormWriter: jest.fn().mockImplementation(() => form),
  ColumnWriter: jest.fn().mockImplementation(() => columns),
  ChoiceWriter: jest.fn().mockImplementation(() => choices),
  FormLayoutWriter: jest.fn().mockImplementation(() => formLayout),
  ListLayoutWriter: jest.fn().mockImplementation(() => listLayout),
  MetadataScopeError, MetadataVerificationError,
  isPolicyRefusal: (e: unknown) => e instanceof PolicyRefusal,
  redactMessage: (m: string) => m.replace(/secret-\w+/g, '[redacted]'),
  // working-set.ts (instanceParam) and logging are imported with the module.
  WorkingSetManager: jest.fn(), UpdateSetExporter: jest.fn(), WorkingSetError: class extends Error {}, UpdateSetExportError: class extends Error {},
  Logger: jest.fn().mockImplementation(() => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
  configureLogging: jest.fn(), redactValue: jest.fn((v: unknown) => v), flushLogs: jest.fn(() => Promise.resolve()),
}))

const tools = await import('../../../src/tools/metadata.js')

const SET = 'c'.repeat(32), REC = 'a'.repeat(32), SCOPE_ID = 'b'.repeat(32), SECTION = 'd'.repeat(32)
const capture = { action: 'INSERT_OR_UPDATE', updateSetName: 'FEAT-1', updateSetSysId: SET, updateName: `sys_script_include_${REC}`,
  currentUpdateSet: { switched: false }, recordScope: SCOPE_ID, updateSetScope: SCOPE_ID, preferencesUnchanged: true, preferenceRowsReplaced: [] }
const writeResult = (action: string) => ({ table: 'sys_script_include', sysId: REC, action, scope: { scope: 'x_app', sysId: SCOPE_ID }, capture, messages: ['Record <b>saved</b>'] })
const T = { scope: 'x_app', update_set: SET }

let server: McpServer, client: Client
beforeEach(async () => {
  jest.clearAllMocks()
  mockWithConnectionRetry.mockImplementation(async (_a: any, op: any) => op({}))
  server = new McpServer({ name: 't', version: '1' })
  for (const [name, register] of Object.entries(tools)) if (name.startsWith('register')) (register as (s: McpServer) => void)(server)
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s)
  client = new Client({ name: 'c', version: '1' }); await client.connect(c)
})
afterEach(async () => { await client.close(); await server.close() })

const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args })
  return { text: r.content[0].text as string, isError: r.isError === true }
}
const options = () => mockWithConnectionRetry.mock.calls.at(-1)![2]

describe('records', () => {
  it('inserts through the form in the named application and set, never replayed, and reports the capture', async () => {
    form.insert.mockResolvedValue(writeResult('insert'))
    const { text, isError } = await call('insert_metadata_record', { table: 'sys_script_include', ...T,
      fields: { name: 'Util', script: 'var Util = Class.create();', active: true, client_callable: false, sys_policy: null } })
    expect(isError).toBe(false)
    expect(form.insert).toHaveBeenCalledWith('sys_script_include', { scope: { scope: 'x_app' }, updateSet: SET,
      fields: { name: 'Util', script: 'var Util = Class.create();', active: true, client_callable: false, sys_policy: null } })
    expect(options()).toEqual({ retry: false })
    expect(text).toContain(`Capture: INSERT_OR_UPDATE in FEAT-1 (${SET})`)
    expect(text).toContain('Instance said: Record [omitted]saved[omitted]')
  })

  it('maps global, a scope sys_id, and a Store acknowledgement', async () => {
    form.update.mockResolvedValue(writeResult('update'))
    await call('update_metadata_record', { table: 'sys_properties', sys_id: REC, scope: 'global', update_set: SET, fields: { value: '5' } })
    expect(form.update).toHaveBeenLastCalledWith('sys_properties', REC, { scope: 'global', updateSet: SET, fields: { value: '5' } })
    await call('update_metadata_record', { table: 'sys_properties', sys_id: REC, scope_id: SCOPE_ID, update_set: SET, acknowledge_upgrade_skip: true, fields: { value: '5' } })
    expect(form.update).toHaveBeenLastCalledWith('sys_properties', REC, { scope: { sysId: SCOPE_ID }, updateSet: SET,
      storeCustomization: { acknowledgeUpgradeSkip: true }, fields: { value: '5' } })
  })

  it('refuses bad input before calling core', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['insert_metadata_record', { table: 'sys_script_include', ...T }],
      ['insert_metadata_record', { table: 'sys_script_include', scope: 'x_app', fields: { name: 'x' } }],
      ['insert_metadata_record', { table: 'sys_script_include', update_set: SET, fields: { name: 'x' } }],
      ['insert_metadata_record', { table: 'sys_script_include', ...T, scope_id: SCOPE_ID, fields: { name: 'x' } }],
      ['insert_metadata_record', { table: 'sys_script_include', ...T, fields: { 'name.x': 'x' } }],
      ['insert_metadata_record', { table: 'sys_script_include', ...T, fields: { timeout: {} } }],
      ['insert_metadata_record', { table: 'sys_script_include', ...T, initial_query: 'name=x^ORname=y^javascript:1' }],
      ['insert_metadata_record', { table: 'sys_script_include', ...T, initial_query: 'name=javascript:gs.log(1)' }],
      ['insert_metadata_record', { table: 'sys_script_include', ...T, initial_query: 'sys_scope=global' }],
      ['insert_metadata_record', { table: 'sys_script_include', ...T, initial_query: 'name=a^name=b' }],
      ['update_metadata_record', { table: 'sys_script_include', sys_id: REC, ...T }],
      ['delete_metadata_record', { table: 'sys_script_include', sys_id: REC, confirm_table: 'sys_script', confirm_sys_id: REC, ...T }],
    ]
    for (const [name, args] of cases) expect([name, JSON.stringify(args), (await call(name, args)).isError]).toEqual([name, JSON.stringify(args), true])
    expect(form.insert).not.toHaveBeenCalled()
    expect(form.update).not.toHaveBeenCalled()
    expect(form.delete).not.toHaveBeenCalled()
  })

  it('refuses a __proto__ or constructor key, whatever its value, before calling core', async () => {
    // JSON.parse makes __proto__ an own key, as a client's JSON would.
    for (const json of ['{"__proto__": "x", "a": 1}', '{"__proto__": {"days": 1}, "a": 1}', '{"constructor": "x"}']) {
      expect((await call('insert_metadata_record', { table: 'sys_script_include', ...T, fields: JSON.parse(json) })).isError).toBe(true)
    }
    expect(form.insert).not.toHaveBeenCalled()
    expect(({} as any).days).toBeUndefined()
  })

  it('deletes with the confirmation repeated', async () => {
    form.delete.mockResolvedValue(writeResult('delete'))
    await call('delete_metadata_record', { table: 'sys_script_include', sys_id: REC, confirm_table: 'sys_script_include', confirm_sys_id: REC, ...T })
    expect(form.delete).toHaveBeenCalledWith('sys_script_include', REC, { scope: { scope: 'x_app' }, updateSet: SET,
      confirm: { table: 'sys_script_include', sysId: REC } })
  })

  it('explains refusals without naming a parameter to flip, and failed verifications', async () => {
    form.update.mockRejectedValue(new MetadataScopeError('store_scope'))
    let r = await call('update_metadata_record', { table: 'sys_script_include', sys_id: REC, ...T, fields: { name: 'x' } })
    expect(r.text).toContain('stop and ask the user')
    expect(r.text).not.toContain('acknowledge_upgrade_skip')
    form.update.mockRejectedValue(new MetadataScopeError('elevation_required', { table: 'sys_security_acl' }))
    r = await call('update_metadata_record', { table: 'sys_security_acl', sys_id: REC, ...T, fields: { active: false } })
    expect(r.text).toContain('ACL tools')
    form.update.mockRejectedValue(new MetadataVerificationError('not_captured', 'sys_script_include', REC, undefined, ['secret-abc failed'], true))
    r = await call('update_metadata_record', { table: 'sys_script_include', sys_id: REC, ...T, fields: { name: 'x' } })
    expect(r.text).toContain('not_captured: the write could not be verified (it was attempted)')
    expect(r.text).toContain('Instance said: [redacted] failed')
    expect(r.text).toContain('read the record and its capture before retrying')
    form.update.mockRejectedValue(new MetadataScopeError('invalid_input', { updateSetState: 'complete', updateSetApplication: SCOPE_ID }))
    r = await call('update_metadata_record', { table: 'sys_script_include', sys_id: REC, ...T, fields: { name: 'x' } })
    expect(r.text).toContain('The update set is not In progress, or belongs to another application')
    form.update.mockRejectedValue(new MetadataVerificationError('captured_elsewhere', 'sys_script_include', REC, undefined, [], true))
    r = await call('update_metadata_record', { table: 'sys_script_include', sys_id: REC, ...T, fields: { name: 'x' } })
    expect(r.text).toContain('move_update_set_capture')
    form.update.mockRejectedValue(new PolicyRefusal('Refused: changing instance data'))
    r = await call('update_metadata_record', { table: 'sys_script_include', sys_id: REC, ...T, fields: { name: 'x' } })
    expect(r.text).toContain('refused by policy')
  })
})

describe('columns', () => {
  it('adds a reference column, and refuses a reference without a table first', async () => {
    columns.addColumn.mockResolvedValue({ table: 'x_app_thing', column: 'owner', sysId: REC, label: 'Owner', type: 'reference',
      scope: { scope: 'x_app', sysId: SCOPE_ID }, formSections: [SECTION], captures: ['sys_dictionary_x_app_thing_owner'], capture, messages: [] })
    expect((await call('add_table_column', { table: 'x_app_thing', column: 'owner', label: 'Owner', type: 'reference', ...T })).isError).toBe(true)
    const r = await call('add_table_column', { table: 'x_app_thing', column: 'owner', label: 'Owner', type: 'reference', reference: 'sys_user', ...T })
    expect(columns.addColumn).toHaveBeenCalledTimes(1)
    expect(columns.addColumn).toHaveBeenCalledWith('x_app_thing', { scope: { scope: 'x_app' }, updateSet: SET, column: 'owner', label: 'Owner',
      type: 'reference', reference: 'sys_user' })
    expect(r.text).toContain('Column added and verified: x_app_thing.owner (reference)')
  })

  it('removes a column only with <table>.<column> repeated, passing the acknowledgements', async () => {
    columns.removeColumn.mockResolvedValue({ table: 't', column: 'u_x', sysId: REC, scope: { scope: 'global', sysId: 'global' }, records: 3,
      createdInThisSet: false, deleted: { labels: ['l1'], clientScripts: [], uiPolicyActions: [] }, captures: ['sys_dictionary_t_u_x'],
      leftovers: { choices: 2, formElements: [], listElements: [] }, capture, messages: [] })
    expect((await call('remove_table_column', { table: 't', column: 'u_x', confirm: 't.u_y', ...T })).isError).toBe(true)
    const r = await call('remove_table_column', { table: 't', column: 'u_x', confirm: 't.u_x', acknowledge_data_loss: true, ...T })
    expect(columns.removeColumn).toHaveBeenCalledWith('t', 'u_x', { scope: { scope: 'x_app' }, updateSet: SET,
      confirm: { table: 't', column: 'u_x' }, acknowledgeDataLoss: true })
    expect(r.text).toContain('Rows that held a value: 3')
    expect(r.text).toContain('Left behind by the platform: 2 choice(s)')
    columns.removeColumn.mockRejectedValue(new MetadataScopeError('column_has_data', { records: 3 }))
    const refused = await call('remove_table_column', { table: 't', column: 'u_x', confirm: 't.u_x', ...T })
    expect(refused.text).toContain('Detail: records: 3')
    expect(refused.text).toContain('Stop and ask the user whether those values may be lost')
    expect(refused.text).not.toContain('acknowledg')
  })
})

describe('choices', () => {
  const choice = { sysId: REC, value: 'high', label: 'High', sequence: 3, inactive: false, hint: '', dependentValue: '', language: 'en' }
  it('reads a list with its application', async () => {
    choices.getChoices.mockResolvedValue({ table: 'incident', element: 'u_level', language: 'en', column: { table: 'incident', type: 'string', choice: '1', scope: 'global' },
      choiceSet: { sysId: REC, scope: 'global', updateName: 'sys_choice_incident_u_level' }, choices: [choice] })
    const r = await call('get_choice_list', { table: 'incident', column: 'u_level' })
    expect(r.text).toContain('List application: global (capture sys_choice_incident_u_level)')
    expect(r.text).toContain('- high: High (sequence 3)')
    expect(options()).toBeUndefined()
  })

  it('sets and removes a choice, and refuses a value that could break a query', async () => {
    choices.setChoice.mockResolvedValue({ table: 'incident', element: 'u_level', language: 'en', value: 'high', action: 'update', sysId: REC,
      choice: { ...choice, inactive: true }, previous: choice, choices: [], column: {}, scope: { scope: 'global', sysId: 'global' }, capture, messages: [] })
    const r = await call('set_choice', { table: 'incident', column: 'u_level', value: 'high', inactive: true, scope: 'global', update_set: SET })
    expect(choices.setChoice).toHaveBeenCalledWith('incident', 'u_level', { scope: 'global', updateSet: SET, value: 'high', inactive: true })
    expect(r.text).toContain('Now: high: High (sequence 3) INACTIVE')
    for (const value of ['a^b', 'javascript:x', '']) {
      expect((await call('set_choice', { table: 'incident', column: 'u_level', value, scope: 'global', update_set: SET })).isError).toBe(true)
    }
    choices.removeChoice.mockRejectedValue(new MetadataScopeError('choice_in_use', { records: 4 }))
    const refused = await call('remove_choice', { table: 'incident', column: 'u_level', value: 'high', scope: 'global', update_set: SET })
    expect(refused.text).toContain('Prefer set_choice with inactive')
  })
})

describe('layouts', () => {
  it('reads and replaces a form section, reporting the previous layout to restore', async () => {
    formLayout.getFormLayout.mockResolvedValue({ section: SECTION, table: 'incident', view: '', caption: '', scope: 'global', elements: ['number', '.split', 'state'] })
    expect((await call('get_form_layout', { section: SECTION })).text).toContain('Elements (3): number, .split, state')
    formLayout.setFormLayout.mockResolvedValue({ section: SECTION, table: 'incident', view: '', scope: { scope: 'global', sysId: 'global' },
      elements: ['number', 'state'], previousElements: ['number', '.split', 'state'], capture })
    const r = await call('set_form_layout', { section: SECTION, elements: ['number', 'state'], scope: 'global', update_set: SET })
    expect(formLayout.setFormLayout).toHaveBeenCalledWith(SECTION, { scope: 'global', updateSet: SET, elements: ['number', 'state'] })
    expect(r.text).toContain('Before (to restore): number, .split, state')
    expect((await call('set_form_layout', { section: SECTION, elements: ['<b>'], scope: 'global', update_set: SET })).isError).toBe(true)
    // A field twice is refused; split markers may repeat.
    expect((await call('set_form_layout', { section: SECTION, elements: ['number', 'number'], scope: 'global', update_set: SET })).isError).toBe(true)
  })

  it('saves back a layout holding dot-walked fields as get_form_layout returned it', async () => {
    formLayout.getFormLayout.mockResolvedValue({ section: SECTION, table: 'incident', view: '', caption: '', scope: 'global', elements: ['number', '.split', 'caller_id.email', '.split'] })
    const read = await call('get_form_layout', { section: SECTION })
    const elements = read.text.split('): ')[1].split(', ')
    formLayout.setFormLayout.mockResolvedValue({ section: SECTION, table: 'incident', view: '', scope: { scope: 'global', sysId: 'global' },
      elements, previousElements: elements, capture })
    expect((await call('set_form_layout', { section: SECTION, elements, scope: 'global', update_set: SET })).isError).toBe(false)
    expect(formLayout.setFormLayout).toHaveBeenCalledWith(SECTION, expect.objectContaining({ elements: ['number', '.split', 'caller_id.email', '.split'] }))
  })

  it('reads and replaces list columns, dot-walked allowed', async () => {
    listLayout.getListLayout.mockResolvedValue({ table: 'incident', view: '', exists: true, sysId: REC, scope: 'global', columns: ['number', 'caller_id.name'] })
    expect((await call('get_list_layout', { table: 'incident' })).text).toContain('Columns (2): number, caller_id.name')
    listLayout.setListLayout.mockResolvedValue({ table: 'incident', view: 'ess', scope: { scope: 'global', sysId: 'global' }, sysId: REC, created: true,
      columns: ['number'], previousColumns: [], capture })
    const r = await call('set_list_layout', { table: 'incident', view: 'ess', columns: ['number'], scope: 'global', update_set: SET })
    expect(listLayout.setListLayout).toHaveBeenCalledWith('incident', { scope: 'global', updateSet: SET, columns: ['number'], view: 'ess' })
    expect(r.text).toContain('the save created one')
  })

  it('never lists a layout longer than a save can replace', async () => {
    const many = Array.from({ length: 501 }, (_, i) => `f${i}`)
    formLayout.getFormLayout.mockResolvedValue({ section: SECTION, table: 'incident', view: '', caption: '', scope: 'global', elements: many })
    let r = await call('get_form_layout', { section: SECTION })
    expect(r.text).toContain('Elements: 501, more than set_form_layout can replace (500). Change this section in the Form Layout UI.')
    expect(r.text).not.toContain('f499')
    listLayout.getListLayout.mockResolvedValue({ table: 'incident', view: '', exists: true, columns: many.slice(0, 201) })
    r = await call('get_list_layout', { table: 'incident' })
    expect(r.text).toContain('Columns: 201, more than set_list_layout can replace (200)')
    formLayout.getFormLayout.mockResolvedValue({ section: SECTION, table: 'incident', view: '', caption: '', scope: 'global', elements: many.slice(0, 500) })
    expect((await call('get_form_layout', { section: SECTION })).text).toContain('f499')
  })

  it('points to the update set when core gives no detail, and says nothing was posted when nothing was', async () => {
    listLayout.setListLayout.mockRejectedValue(new MetadataScopeError('invalid_input'))
    let r = await call('set_list_layout', { table: 'incident', columns: ['number'], scope: 'global', update_set: SET })
    expect(r.text).toContain('The update set may not exist')
    listLayout.setListLayout.mockRejectedValue(new MetadataVerificationError('session_changed', 'sys_ui_list', REC, undefined, [], false))
    r = await call('set_list_layout', { table: 'incident', columns: ['number'], scope: 'global', update_set: SET })
    expect(r.text).toContain('session_changed: nothing was posted')
    columns.removeColumn.mockRejectedValue(new MetadataScopeError('delete_not_supported'))
    r = await call('remove_table_column', { table: 't', column: 'u_x', confirm: 't.u_x', scope: 'global', update_set: SET })
    expect(r.text).toContain('Delete Column action')
  })

  it('says a read failure is only a read failure', async () => {
    listLayout.getListLayout.mockRejectedValue(new Error('socket hang up'))
    const r = await call('get_list_layout', { table: 'incident' })
    expect(r.isError).toBe(true)
    expect(r.text).not.toContain('may have been applied')
  })
})
