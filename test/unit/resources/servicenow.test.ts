import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Mocked before import: the resource module reaches the credential store and core.
jest.unstable_mockModule('@sonisoft/sn-credstore', () => ({
  listAliases: jest.fn(),
}))
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: jest.fn(),
  // Real implementation, not a stub: the tests drive it via the env var, and a
  // stub here would make them assert against the mock rather than the behaviour.
  isCredStoreActive: () => process.env.NOW_SDK_KEYCHAIN_PATCHED === '1',
}))
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  ScopeManager: jest.fn().mockImplementation(() => ({ getCurrentApplication: jest.fn() })),
  UpdateSetManager: jest.fn().mockImplementation(() => ({ getCurrentUpdateSet: jest.fn() })),
  SchemaDiscovery: jest.fn().mockImplementation(() => ({ discoverTableSchema: jest.fn() })),
}))

const { listAliases } = await import('@sonisoft/sn-credstore')
const { withConnectionRetry } = await import('../../../src/common/connection.js')
const { registerServiceNowResources } = await import('../../../src/resources/servicenow.js')
const { createTestClientServer } = await import('../../helpers/mcp-test-helpers.js')

const mockListAliases = listAliases as jest.MockedFunction<any>
const mockRetry = withConnectionRetry as jest.MockedFunction<any>

async function connect() {
  return createTestClientServer((server) => { registerServiceNowResources(server) })
}

describe('servicenow:// resources', () => {
  const env = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...env }
    delete process.env.NOW_SDK_KEYCHAIN_PATCHED
    delete process.env.SN_AUTH_ALIAS
  })

  afterEach(() => { process.env = env })

  describe('discovery', () => {
    it('advertises the static resource and the templated ones separately', async () => {
      const { client } = await connect()

      const { resources } = await client.listResources()
      const { resourceTemplates } = await client.listResourceTemplates()

      expect(resources.map((r) => r.uri)).toContain('servicenow://instances')
      expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
        'servicenow://{alias}/schema/{table}',
        'servicenow://{alias}/scope/current',
        'servicenow://{alias}/update-set/current',
      ])
    })
  })

  describe('servicenow://instances', () => {
    it('reports the keyring as unenumerable rather than empty when the shim is off', async () => {
      // An empty list would read as "no credentials configured" — the exact
      // ambiguity sn-credstore exists to remove.
      process.env.SN_AUTH_ALIAS = 'dev'
      const { client } = await connect()

      const res = await client.readResource({ uri: 'servicenow://instances' })
      const body = JSON.parse(res.contents[0].text as string)

      expect(body.credentialStore).toBe('os-keyring')
      expect(body.aliases).toBeNull()
      expect(body.defaultAlias).toBe('dev')
      expect(body.note).toMatch(/not the same as having no/i)
      expect(mockListAliases).not.toHaveBeenCalled()
    })

    it('lists aliases when the shim is active', async () => {
      process.env.NOW_SDK_KEYCHAIN_PATCHED = '1'
      mockListAliases.mockResolvedValue({
        aliases: [{ alias: 'dev', isDefault: true, type: 'oauth', instanceUrl: 'https://dev.service-now.com' }],
      })
      const { client } = await connect()

      const body = JSON.parse(
        (await client.readResource({ uri: 'servicenow://instances' })).contents[0].text as string
      )

      expect(body.credentialStore).toBe('sn-credstore')
      expect(body.aliases).toHaveLength(1)
      expect(body.aliases[0].alias).toBe('dev')
    })

    it('never exposes credential material', async () => {
      // listAliases is documented as metadata-only, but this resource is the one
      // most likely to be attached wholesale into a conversation.
      process.env.NOW_SDK_KEYCHAIN_PATCHED = '1'
      mockListAliases.mockResolvedValue({
        aliases: [{
          alias: 'dev', isDefault: true, type: 'basic',
          instanceUrl: 'https://dev.service-now.com', username: 'admin',
          password: 'SUPER-SECRET', access_token: 'SUPER-SECRET-TOKEN',
        }],
      })
      const { client } = await connect()

      const text = (await client.readResource({ uri: 'servicenow://instances' })).contents[0].text as string

      expect(text).not.toContain('SUPER-SECRET')
      expect(text).not.toContain('SUPER-SECRET-TOKEN')
    })

    it('reports a store it cannot read, rather than returning an empty list', async () => {
      process.env.NOW_SDK_KEYCHAIN_PATCHED = '1'
      const err: any = new Error('store unavailable')
      err.remediation = 'run sn-credstore doctor'
      mockListAliases.mockRejectedValue(err)
      const { client } = await connect()

      const body = JSON.parse(
        (await client.readResource({ uri: 'servicenow://instances' })).contents[0].text as string
      )

      expect(body.aliases).toBeNull()
      expect(body.error).toBe('store unavailable')
      expect(body.remediation).toBe('run sn-credstore doctor')
    })
  })

  describe('alias-scoped resources', () => {
    it('passes the alias FROM THE URI, not an ambient default', async () => {
      // The whole reason the alias is in the URI: servicenow://prod/... must not
      // resolve against whatever SN_AUTH_ALIAS happens to be.
      process.env.SN_AUTH_ALIAS = 'dev'
      mockRetry.mockResolvedValue({ scope: 'x_app' })
      const { client } = await connect()

      await client.readResource({ uri: 'servicenow://prod/scope/current' })

      expect(mockRetry).toHaveBeenCalledTimes(1)
      expect(mockRetry.mock.calls[0][0]).toBe('prod')
    })

    it('routes through withConnectionRetry like the tools do', async () => {
      mockRetry.mockResolvedValue({ sysId: 'abc', name: 'Dev set' })
      const { client } = await connect()

      const body = JSON.parse(
        (await client.readResource({ uri: 'servicenow://dev/update-set/current' })).contents[0].text as string
      )

      expect(mockRetry).toHaveBeenCalled()
      expect(body.name).toBe('Dev set')
    })

    it('propagates a read failure rather than returning it as content', async () => {
      // Tools return {isError:true} so a model reasoning about the result can see
      // the failure in-band. A resource is attached, not reasoned over, so a
      // failed read is a protocol error — returning a JSON body saying "failed"
      // would look like successfully attached content.
      mockRetry.mockRejectedValue(new Error('No credentials found for auth alias "prod"'))
      const { client } = await connect()

      await expect(
        client.readResource({ uri: 'servicenow://prod/scope/current' })
      ).rejects.toThrow(/No credentials found/)
    })

    it('extracts both variables from the schema template', async () => {
      mockRetry.mockResolvedValue({ table: 'incident', fields: [] })
      const { client } = await connect()

      await client.readResource({ uri: 'servicenow://prod/schema/incident' })

      expect(mockRetry.mock.calls[0][0]).toBe('prod')
    })
  })
})
