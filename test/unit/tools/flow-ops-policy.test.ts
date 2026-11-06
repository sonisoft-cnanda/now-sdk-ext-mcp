import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

const mockWithConnectionRetry = jest.fn<(alias: any, op: any, options?: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: mockWithConnectionRetry }))

const fm = {
  getFlowDesignDefinition: jest.fn<(...a: any[]) => Promise<any>>(), getSubflowDefinition: jest.fn<(...a: any[]) => Promise<any>>(),
  getActionDefinition: jest.fn<(...a: any[]) => Promise<any>>(), sendFlowMessage: jest.fn<(...a: any[]) => Promise<any>>(),
}
const ctm = { getTransactions: jest.fn<(...a: any[]) => Promise<any>>(), killTransaction: jest.fn<(...a: any[]) => Promise<any>>() }
const FlowManager = jest.fn().mockImplementation(() => fm)
class PolicyRefusal extends Error {}
const checkRequirement = jest.fn((r: any) => ({ allowed: r.verbs[0] === 'write', verbs: r.verbs, decidingLayer: r.verbs[0] === 'write' ? 'default (changes permitted)' : 'NEX_POLICY_DENY' }))

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  FlowManager,
  ClusterTransactionManager: jest.fn().mockImplementation(() => ctm),
  isPolicyRefusal: (e: unknown) => e instanceof PolicyRefusal,
  redactMessage: (m: string) => m.replace(/secret-\w+/g, '[redacted]'),
  checkRequirement,
  currentLayers: () => [{ name: 'NEX_POLICY_DENY' }, { name: 'default (changes permitted)' }],
  DENY_ENV: 'NEX_POLICY_DENY',
  // Modules imported alongside (working-set, metadata, logging).
  WorkingSetManager: jest.fn(), UpdateSetExporter: jest.fn(), WorkingSetError: class extends Error {}, UpdateSetExportError: class extends Error {},
  MetadataFormWriter: jest.fn(), ColumnWriter: jest.fn(), ChoiceWriter: jest.fn(), FormLayoutWriter: jest.fn(), ListLayoutWriter: jest.fn(),
  MetadataScopeError: class extends Error {}, MetadataVerificationError: class extends Error {},
  Logger: jest.fn().mockImplementation(() => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
  configureLogging: jest.fn(), redactValue: jest.fn((v: unknown) => v), flushLogs: jest.fn(() => Promise.resolve()),
}))

const flowTools = await import('../../../src/tools/flow-design.js')
const txTools = await import('../../../src/tools/transactions.js')
const policyTools = await import('../../../src/tools/policy-status.js')

const F = 'a'.repeat(32), C = 'b'.repeat(32), T = 'c'.repeat(32)

let server: McpServer, client: Client
beforeEach(async () => {
  jest.clearAllMocks()
  mockWithConnectionRetry.mockImplementation(async (_a: any, op: any) => op({}))
  server = new McpServer({ name: 't', version: '1' })
  for (const mod of [flowTools, txTools, policyTools]) for (const [n, r] of Object.entries(mod)) if (n.startsWith('register')) (r as (s: McpServer) => void)(server)
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s)
  client = new Client({ name: 'c', version: '1' }); await client.connect(c)
})
afterEach(async () => { await client.close(); await server.close() })
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args })
  return { text: r.content[0].text as string, isError: r.isError === true }
}

describe('get_flow_definition', () => {
  it('reads each type with its own call, and summarises by default', async () => {
    fm.getFlowDesignDefinition.mockResolvedValue({ success: true, sysId: F, artifactType: 'flow', summary: { name: 'Onboard' }, definition: { big: 'x' } })
    const flow = await call('get_flow_definition', { sys_id: F, scope: 'x_app' })
    expect(fm.getFlowDesignDefinition).toHaveBeenCalledWith(F, { scope: 'x_app' })
    expect(flow.text).toContain('"name": "Onboard"')
    expect(flow.text).not.toContain('"big"')
    expect(flow.text).toMatch(/\[end [0-9a-f]{12}\] End of flow definition read from the instance\.$/)
    fm.getSubflowDefinition.mockResolvedValue({ success: true, sysId: F, artifactType: 'subflow', definition: { token: 'secret-abc' } })
    const full = await call('get_flow_definition', { sys_id: F, type: 'subflow', view: 'full' })
    expect(fm.getSubflowDefinition).toHaveBeenCalledWith(F, undefined)
    expect(full.text).toContain('[redacted]')
    expect(full.text).not.toContain('secret-abc')
    fm.getActionDefinition.mockResolvedValue({ success: false, sysId: F, failureReason: 'type_mismatch', errorMessage: 'It is a <b>flow</b>' })
    const mismatch = await call('get_flow_definition', { sys_id: F, type: 'action' })
    expect(mismatch.isError).toBe(true)
    expect(mismatch.text).toContain('no action definition for')
    expect(mismatch.text).toContain('(type_mismatch): It is a flow')
  })

  it('refuses a malformed sys_id before calling', async () => {
    expect((await call('get_flow_definition', { sys_id: 'nope' })).isError).toBe(true)
    expect(mockWithConnectionRetry).not.toHaveBeenCalled()
  })
})

describe('send_flow_message', () => {
  it('sends once, in the scope given, and reports success', async () => {
    fm.sendFlowMessage.mockResolvedValue({ success: true, contextId: C })
    const { text, isError } = await call('send_flow_message', { context_id: C, message: 'approved', payload: '{"a":1}', scope: 'x_app' })
    expect(isError).toBe(false)
    expect(FlowManager).toHaveBeenCalledWith({}, 'x_app')
    expect(fm.sendFlowMessage).toHaveBeenCalledWith(C, 'approved', '{"a":1}')
    expect(mockWithConnectionRetry.mock.calls[0][2]).toEqual({ retry: false })
    expect(text).toContain(`sent to flow context ${C}`)
    expect(text).toContain('does not say whether a step was waiting')
  })

  it('refuses line breaks, which would break the sending script', async () => {
    expect((await call('send_flow_message', { context_id: C, message: 'a\nb' })).isError).toBe(true)
    expect((await call('send_flow_message', { context_id: C, message: 'ok', payload: '{\n"a":1}' })).isError).toBe(true)
    expect((await call('send_flow_message', { context_id: C, message: 'ok', payload: 'a b' })).isError).toBe(true)
    expect((await call('send_flow_message', { context_id: C, message: '   ' })).isError).toBe(true)
    expect(fm.sendFlowMessage).not.toHaveBeenCalled()
  })

  it('tells a platform refusal from a script that may have run', async () => {
    fm.sendFlowMessage.mockResolvedValueOnce({ success: false, contextId: C, errorMessage: 'No wait for message', rawScriptResult: {} })
    const refused = await call('send_flow_message', { context_id: C, message: 'go' })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('the platform did not accept the message')
    expect(refused.text).not.toContain('may have been delivered')
    fm.sendFlowMessage.mockResolvedValueOnce({ success: false, contextId: C, errorMessage: 'Script execution error: socket hang up', rawScriptResult: null })
    expect((await call('send_flow_message', { context_id: C, message: 'go' })).text).toContain('may have been delivered')
    fm.sendFlowMessage.mockRejectedValueOnce(new PolicyRefusal('Running scripts or flows is not permitted'))
    const policy = await call('send_flow_message', { context_id: C, message: 'go' })
    expect(policy.text).toContain('refused by policy')
    expect(policy.text).not.toContain('may have been delivered')
  })
})

describe('transactions', () => {
  it('lists with defaults and cleans each row', async () => {
    ctm.getTransactions.mockResolvedValue([{ sys_id: T, node_id: 'node1', user: 'admin', age: '00:01:05', url: '/api/now/table/incident?x=<b>1</b>',
      type: 'REST', foreground: 'true', thread: 't', state: 'running', query_count: '12' }])
    const { text } = await call('list_transactions', {})
    expect(ctm.getTransactions).toHaveBeenCalledWith({ limit: 200, timeoutMs: 60_000 })
    expect(text).toContain(`- ${T} on node1: admin, age 00:01:05, REST, running, foreground, 12 queries: /api/now/table/incident?x=1`)
    await call('list_transactions', { query: 'ageGREATERTHAN60000', limit: 5, timeout_seconds: 10 })
    expect(ctm.getTransactions).toHaveBeenLastCalledWith({ query: 'ageGREATERTHAN60000', limit: 5, timeoutMs: 10_000 })
    expect((await call('list_transactions', { query: 'javascript:gs.log(1)' })).isError).toBe(true)
  })

  it('kills only on a matching confirmation, never replayed', async () => {
    const wrong = await call('kill_transaction', { transaction_id: T, confirm: 'd'.repeat(32) })
    expect(wrong.isError).toBe(true)
    expect(ctm.killTransaction).not.toHaveBeenCalled()
    ctm.killTransaction.mockResolvedValue({ accepted: true, sysId: T })
    const ok = await call('kill_transaction', { transaction_id: T, confirm: T })
    expect(ok.text).toContain(`accepted the request to kill ${T}`)
    expect(mockWithConnectionRetry.mock.calls[0][2]).toEqual({ retry: false })
    ctm.killTransaction.mockResolvedValue({ accepted: false, sysId: T })
    expect((await call('kill_transaction', { transaction_id: T, confirm: T })).isError).toBe(true)
    ctm.killTransaction.mockRejectedValue(new Error('socket hang up'))
    expect((await call('kill_transaction', { transaction_id: T, confirm: T })).text).toContain('may have been sent')
  })
})

describe('get_policy_status', () => {
  it('reports each verb, its deciding layer, and the layers in order', async () => {
    const before = process.env.NEX_POLICY_DENY
    process.env.NEX_POLICY_DENY = 'execute'
    try {
      const { text } = await call('get_policy_status', {})
      expect(checkRequirement).toHaveBeenCalledWith({ target: 'instance', verbs: ['write'] })
      expect(text).toContain('- write: permitted (decided by default (changes permitted))')
      expect(text).toContain('- execute: REFUSED (decided by NEX_POLICY_DENY)')
      expect(text).toContain('NEX_POLICY_DENY is set')
      expect(text.indexOf('- NEX_POLICY_DENY')).toBeLessThan(text.indexOf('- default (changes permitted)'))
    } finally {
      if (before === undefined) delete process.env.NEX_POLICY_DENY
      else process.env.NEX_POLICY_DENY = before
    }
  })
})
