import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any, options?: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const manager = {
  list: jest.fn<(...args: any[]) => Promise<any>>(),
  get: jest.fn<(...args: any[]) => Promise<any>>(),
  create: jest.fn<(...args: any[]) => Promise<any>>(),
  update: jest.fn<(...args: any[]) => Promise<any>>(),
  delete: jest.fn<(...args: any[]) => Promise<any>>(),
  addRole: jest.fn<(...args: any[]) => Promise<any>>(),
  removeRole: jest.fn<(...args: any[]) => Promise<any>>(),
}
const mockStatus = jest.fn<() => Promise<any>>()

class AclError extends Error {
  constructor(public code: string, public detail?: string) { super(`ACL ${code}`) }
}
class AclPartialError extends AclError {
  constructor(public aclSysId: string, public operation: string, public state: string, public cause: unknown) {
    super('partially_applied')
  }
}
class RoleElevationError extends Error {
  constructor(public code: string, public roles: string[] = [], public available: string[] = []) { super(`Role elevation failed: ${code}`) }
}
class MetadataScopeError extends Error {
  constructor(public code: string, public detail?: unknown) { super(code) }
}
class MetadataVerificationError extends Error {
  constructor(public code: string, public messages: string[], public writeAttempted: boolean) { super(code) }
}
class PolicyRefusal extends Error {}

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  AclManager: jest.fn().mockImplementation(() => manager),
  RoleElevation: jest.fn().mockImplementation(() => ({ status: mockStatus })),
  AclError, AclPartialError, RoleElevationError, MetadataScopeError, MetadataVerificationError,
  isPolicyRefusal: (e: unknown) => e instanceof PolicyRefusal,
  redactMessage: (m: string) => m.replace(/secret-\w+/g, '[redacted]'),
}))

const tools = await import('../../../src/tools/acl.js')

const ACL = 'a'.repeat(32)
const SET = 'c'.repeat(32)
const record = {
  sysId: ACL, name: 'x_app_thing', type: 'record', operation: 'read', active: true, adminOverrides: true, advanced: false,
  decisionType: 'allow', description: 'Agents read', condition: '', script: '', scope: 'b'.repeat(32), scopeName: 'x_app',
  updatedOn: '', roles: [{ sysId: 'r1', roleSysId: 'r'.repeat(32), role: 'x_app.agent' }, { sysId: 'r2', roleSysId: 'n'.repeat(32), role: '' }],
}
const writeResult = {
  acl: record, writes: [{ table: 'sys_security_acl', sysId: ACL, action: 'insert', scope: {}, capture: { updateSetName: 'ACL work', updateSetSysId: SET }, messages: [] }],
  removedAutomaticRoles: ['snc_internal'], warnings: ['snc_internal is one of this ACL\'s roles'],
}

let server: McpServer
let client: Client

beforeEach(async () => {
  jest.clearAllMocks()
  mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => operation({}))
  server = new McpServer({ name: "test-server", version: "1.0.0" })
  for (const register of [tools.registerListAclsTool, tools.registerGetAclTool, tools.registerGetRoleElevationTool,
    tools.registerCreateAclTool, tools.registerUpdateAclTool, tools.registerDeleteAclTool, tools.registerAddAclRoleTool,
    tools.registerRemoveAclRoleTool]) register(server)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: "test-client", version: "1.0.0" })
  await client.connect(clientTransport)
})

afterEach(async () => {
  await client.close()
  await server.close()
})

const call = async (name: string, args: Record<string, unknown>) => {
  const result: any = await client.callTool({ name, arguments: args })
  return { text: result.content[0].text as string, isError: result.isError === true }
}
const options = () => mockWithConnectionRetry.mock.calls.at(-1)![2]

describe('registration', () => {
  it('lists every ACL tool, with the write target on the writes', async () => {
    const { tools: listed } = await client.listTools()
    const names = listed.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_acls', 'get_acl', 'get_role_elevation', 'create_acl', 'update_acl',
      'delete_acl', 'add_acl_role', 'remove_acl_role']))
    for (const name of ['create_acl', 'update_acl', 'delete_acl', 'add_acl_role', 'remove_acl_role']) {
      const props = listed.find(t => t.name === name)!.inputSchema.properties!
      expect(props).toHaveProperty('scope')
      expect(props).toHaveProperty('update_set')
      expect(listed.find(t => t.name === name)!.description).toContain('security change')
    }
    expect(listed.find(t => t.name === 'delete_acl')!.inputSchema.required).toEqual(expect.arrayContaining(['sys_id', 'confirm']))
  })
})

describe('reads', () => {
  it('lists unelevated by default, naming hidden roles by sys_id', async () => {
    manager.list.mockResolvedValue([record])
    const { text, isError } = await call('list_acls', { instance: 'dev', table: 'x_app_thing', operation: 'read' })
    expect(isError).toBe(false)
    expect(manager.list).toHaveBeenCalledWith({ table: 'x_app_thing', operation: 'read' })
    expect(options()).toBeUndefined()
    expect(text).toContain('1 ACL(s)')
    expect(text).toContain(`roles=[x_app.agent, ${'n'.repeat(32)} (hidden)]`)
  })

  it('reads elevated only when asked, and maps the scope', async () => {
    manager.list.mockResolvedValue([])
    await call('list_acls', { scope: 'global', elevate: true })
    expect(manager.list).toHaveBeenCalledWith({ scope: 'global' })
    expect(options()).toEqual({ elevatedRoles: ['security_admin'] })
    await call('list_acls', { scope_id: 'b'.repeat(32) })
    expect(manager.list).toHaveBeenLastCalledWith({ scope: { sysId: 'b'.repeat(32) } })
  })

  it('reports core\'s filter_required with what to pass', async () => {
    manager.list.mockRejectedValue(new AclError('filter_required'))
    const { text, isError } = await call('list_acls', {})
    expect(isError).toBe(true)
    expect(text).toContain('filter_required')
    expect(text).toContain('Pass at least one of table, name, scope or scope_id.')
  })

  it('shows one ACL and says a script with advanced off still runs', async () => {
    manager.get.mockResolvedValue({ ...record, script: 'answer = false;' })
    const { text } = await call('get_acl', { sys_id: ACL })
    expect(manager.get).toHaveBeenCalledWith(ACL)
    expect(text).toContain('Script: 1 line(s) (advanced off: hidden on the form, still runs)')
    expect(text).toContain('"sysId": "' + ACL + '"')
  })

  it('rejects a sys_id that is not one before calling core', async () => {
    const result: any = await client.callTool({ name: 'get_acl', arguments: { sys_id: 'abc' } })
    expect(result.isError).toBe(true)
    expect(manager.get).not.toHaveBeenCalled()
  })

  it('reports elevation status, elevating only the roles asked for', async () => {
    mockStatus.mockResolvedValue({ available: [{ name: 'security_admin', description: 'High security' }], elevated: ['security_admin'] })
    const { text } = await call('get_role_elevation', { elevate: ['security_admin'] })
    expect(options()).toEqual({ elevatedRoles: ['security_admin'] })
    expect(text).toContain('- security_admin (ELEVATED): High security')
    mockStatus.mockResolvedValue({ available: [], elevated: [] })
    expect((await call('get_role_elevation', {})).text).toContain('This user may not elevate to any role.')
    expect(options()).toBeUndefined()
  })

  it('explains not_elevatable without suggesting a workaround', async () => {
    mockStatus.mockRejectedValue(new RoleElevationError('not_elevatable', ['security_admin'], ['x_app.auditor']))
    const { text, isError } = await call('get_role_elevation', { elevate: ['security_admin'] })
    expect(isError).toBe(true)
    expect(text).toContain('not_elevatable (security_admin)')
    expect(text).toContain('Roles this user may elevate to: x_app.auditor')
    expect(text).toContain('Do not grant the role or switch credentials')
  })
})

describe('writes', () => {
  it('creates elevated, in the named application and set, and reports what the platform did', async () => {
    manager.create.mockResolvedValue(writeResult)
    const { text, isError } = await call('create_acl', { instance: 'dev', scope: 'x_app', update_set: SET, operation: 'read',
      table: 'x_app_thing', roles: ['x_app.agent'], admin_overrides: false, decision_type: 'allow' })
    expect(isError).toBe(false)
    expect(options()).toEqual({ elevatedRoles: ['security_admin'] })
    expect(manager.create).toHaveBeenCalledWith({ scope: { scope: 'x_app' }, updateSet: SET, operation: 'read', table: 'x_app_thing',
      roles: ['x_app.agent'], adminOverrides: false, decisionType: 'allow' })
    expect(text).toContain('Removed the role the platform added on its own: snc_internal')
    expect(text).toContain('WARNING: snc_internal is one of this ACL\'s roles')
    expect(text).toContain(`- insert sys_security_acl ${ACL} in update set ACL work (${SET})`)
  })

  it('needs the ACL\'s application, one way only', async () => {
    let r = await call('create_acl', { operation: 'read', table: 't' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Name the ACL\'s application')
    r = await call('create_acl', { operation: 'read', table: 't', scope: 'x_app', scope_id: 'b'.repeat(32) })
    expect(r.text).toContain('scope or scope_id, not both')
    expect(manager.create).not.toHaveBeenCalled()
  })

  it('passes a Store customization only with an update set', async () => {
    let r = await call('update_acl', { sys_id: ACL, scope: 'sn_vendor', acknowledge_upgrade_skip: true, active: false })
    expect(r.text).toContain('acknowledge_upgrade_skip needs update_set')
    manager.update.mockResolvedValue({ ...writeResult, removedAutomaticRoles: [], warnings: [] })
    r = await call('update_acl', { sys_id: ACL, scope: 'sn_vendor', update_set: SET, acknowledge_upgrade_skip: true, active: false })
    expect(manager.update).toHaveBeenCalledWith(ACL, { scope: { scope: 'sn_vendor' }, updateSet: SET,
      storeCustomization: { acknowledgeUpgradeSkip: true }, active: false })
  })

  it('deletes with the confirmation passed through, and role changes go to core', async () => {
    manager.delete.mockResolvedValue({ previous: record, writes: [], removedAutomaticRoles: [], warnings: [] })
    await call('delete_acl', { sys_id: ACL, confirm: ACL, scope: 'x_app', update_set: SET })
    expect(manager.delete).toHaveBeenCalledWith(ACL, { scope: { scope: 'x_app' }, updateSet: SET, confirm: ACL })
    manager.addRole.mockResolvedValue(writeResult)
    manager.removeRole.mockResolvedValue(writeResult)
    await call('add_acl_role', { sys_id: ACL, role: 'x_app.lead', scope: 'global', update_set: SET })
    expect(manager.addRole).toHaveBeenCalledWith(ACL, 'x_app.lead', { scope: 'global', updateSet: SET })
    await call('remove_acl_role', { sys_id: ACL, role: 'itil', scope: 'global', update_set: SET })
    expect(manager.removeRole).toHaveBeenCalledWith(ACL, 'itil', { scope: 'global', updateSet: SET })
    expect(options()).toEqual({ elevatedRoles: ['security_admin'] })
  })

  it('reports a partial change with the ACL\'s state and the step that failed', async () => {
    manager.create.mockRejectedValue(new AclPartialError(ACL, 'create', 'inactive', new Error('form said secret-xyz')))
    const { text, isError } = await call('create_acl', { scope: 'x_app', update_set: SET, operation: 'read', table: 't', roles: ['r'] })
    expect(isError).toBe(true)
    expect(text).toContain(`the create of ACL ${ACL} stopped part way; the ACL is inactive (read back)`)
    expect(text).toContain('Failed step: form said [redacted]')
    expect(text).toContain('do not retry blindly')
  })

  it('reports unverified writes, scope and policy refusals', async () => {
    manager.update.mockRejectedValue(new MetadataVerificationError('write_not_applied', ['outside field <b>x</b>'], true))
    let r = await call('update_acl', { sys_id: ACL, scope: 'x_app', update_set: SET, condition: 'active=true' })
    expect(r.text).toContain('write_not_applied: the write could not be verified (it was attempted)')
    expect(r.text).toContain('Instance said: outside field [omitted]x[omitted]')
    manager.update.mockRejectedValue(new MetadataScopeError('store_scope'))
    r = await call('update_acl', { sys_id: ACL, scope: 'sn_vendor', condition: 'x' })
    expect(r.text).toContain('acknowledge_upgrade_skip')
    manager.update.mockRejectedValue(new PolicyRefusal('Refused: changing instance data'))
    r = await call('update_acl', { sys_id: ACL, scope: 'x_app', condition: 'x' })
    expect(r.text).toContain('refused by policy: Refused: changing instance data')
  })
})
