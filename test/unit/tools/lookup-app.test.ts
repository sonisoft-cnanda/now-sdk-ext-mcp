import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
const mockIsRetryableResponse = jest.fn<(resp: any) => boolean>()

jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
  isRetryableResponse: mockIsRetryableResponse,
}))

const mockGet = jest.fn<(...args: any[]) => Promise<any>>()
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  TableAPIRequest: jest.fn().mockImplementation(() => ({
    get: mockGet,
  })),
}))

// Dynamic import after mocks (required for ESM)
const { registerLookupAppTool } = await import('../../../src/tools/lookup-app.js')

describe('lookup_app tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()

    // Default: withConnectionRetry executes the callback with a mock instance
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    // Default: isRetryableResponse returns false (response is OK)
    mockIsRetryableResponse.mockReturnValue(false)

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerLookupAppTool(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    client = new Client({ name: "test-client", version: "1.0.0" })
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await server.close()
  })

  describe('tool registration', () => {
    it('should be listed as a registered tool', async () => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('lookup_app')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'lookup_app')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('search_term')
      expect(props).toHaveProperty('type')
      expect(props).toHaveProperty('active_only')
    })

    it('should require search_term', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'lookup_app')!
      expect(tool.inputSchema.required).toContain('search_term')
    })

    it('should not require instance, type, or active_only', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'lookup_app')!
      const required = tool.inputSchema.required ?? []
      expect(required).not.toContain('instance')
      expect(required).not.toContain('type')
      expect(required).not.toContain('active_only')
    })
  })

  describe('combined search (type=all)', () => {
    it('should query sys_scope and sys_plugins and return combined results', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'app-123',
                name: 'Tanium SDK',
                scope: 'x_tanm_tanium_sdk',
                version: '2.1.0',
                vendor: 'Tanium',
                active: 'true',
                short_description: 'Tanium integration for ServiceNow',
                sys_class_name: 'sys_store_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'tanium' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('app-123')
      expect(text).toContain('Tanium SDK')
      expect(text).toContain('x_tanm_tanium_sdk')
      expect(text).toContain('Store App')
      expect(text).toContain('Tanium')
      expect(text).toContain('Found: 1 result(s)')
      expect(text).toContain('execute_script')
    })

    it('should show both applications and plugins when both match', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'app-vul',
                name: 'Vulnerability Response',
                scope: 'sn_vul',
                version: '1.0.0',
                vendor: 'ServiceNow',
                active: 'true',
                short_description: '',
                sys_class_name: 'sys_store_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'plugin-vul',
                name: 'Vulnerability Response',
                id: 'com.snc.vulnerability_response',
                version: '2.0.0',
                active: 'true',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'vulnerability' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('app-vul')
      expect(text).toContain('plugin-vul')
      expect(text).toContain('com.snc.vulnerability_response')
      expect(text).toContain('Found: 2 result(s)')
    })

    it('should call tableApi.get twice when type is "all"', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      expect(mockGet).toHaveBeenCalledTimes(2)
      expect(mockGet).toHaveBeenCalledWith('sys_scope', expect.any(Object))
      expect(mockGet).toHaveBeenCalledWith('sys_plugins', expect.any(Object))
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test', instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith(
        'dev224436',
        expect.any(Function)
      )
    })
  })

  describe('type filtering', () => {
    it('should only query sys_scope when type is "app"', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test', type: 'app' },
      })

      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockGet).toHaveBeenCalledWith('sys_scope', expect.any(Object))

      const text = (result.content as any[])[0].text
      expect(text).toContain('--- Applications')
      expect(text).not.toContain('--- Plugins')
    })

    it('should only query sys_plugins when type is "plugin"', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test', type: 'plugin' },
      })

      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockGet).toHaveBeenCalledWith('sys_plugins', expect.any(Object))

      const text = (result.content as any[])[0].text
      expect(text).not.toContain('--- Applications')
      expect(text).toContain('--- Plugins')
    })
  })

  describe('query construction', () => {
    it('should use LIKE matching on name, scope, and short_description for sys_scope', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'tanium' },
      })

      const scopeParams = mockGet.mock.calls[0][1] as Record<string, string>
      const q = scopeParams.sysparm_query
      expect(q).toContain('nameLIKEtanium')
      expect(q).toContain('scopeLIKEtanium')
      expect(q).toContain('short_descriptionLIKEtanium')
      expect(q).toContain('^NQ')
      expect(q).toContain('ORDERBYname')
    })

    it('should use LIKE matching on name and id for sys_plugins', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'com.snc.vul' },
      })

      const pluginParams = mockGet.mock.calls[1][1] as Record<string, string>
      const q = pluginParams.sysparm_query
      expect(q).toContain('nameLIKEcom.snc.vul')
      expect(q).toContain('idLIKEcom.snc.vul')
      expect(q).toContain('^NQ')
      expect(q).toContain('ORDERBYname')
    })

    it('should not include active filter when active_only is false', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      const scopeParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(scopeParams.sysparm_query).not.toContain('active=true')

      const pluginParams = mockGet.mock.calls[1][1] as Record<string, string>
      expect(pluginParams.sysparm_query).not.toContain('active=true')
    })

    it('should include active=true in every ^NQ branch when active_only is true', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test', active_only: true },
      })

      // Check sys_scope query
      const scopeParams = mockGet.mock.calls[0][1] as Record<string, string>
      const scopeQ = scopeParams.sysparm_query
      expect(scopeQ).toContain('active=true^nameLIKEtest')
      expect(scopeQ).toContain('^NQactive=true^scopeLIKEtest')
      expect(scopeQ).toContain('^NQactive=true^short_descriptionLIKEtest')

      // Check sys_plugins query
      const pluginParams = mockGet.mock.calls[1][1] as Record<string, string>
      const pluginQ = pluginParams.sysparm_query
      expect(pluginQ).toContain('active=true^nameLIKEtest')
      expect(pluginQ).toContain('^NQactive=true^idLIKEtest')
    })

    it('should request the correct fields for sys_scope', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      const scopeParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(scopeParams.sysparm_fields).toContain('sys_id')
      expect(scopeParams.sysparm_fields).toContain('name')
      expect(scopeParams.sysparm_fields).toContain('scope')
      expect(scopeParams.sysparm_fields).toContain('version')
      expect(scopeParams.sysparm_fields).toContain('vendor')
      expect(scopeParams.sysparm_fields).toContain('active')
      expect(scopeParams.sysparm_fields).toContain('short_description')
      expect(scopeParams.sysparm_fields).toContain('sys_class_name')
    })

    it('should request the correct fields for sys_plugins', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      const pluginParams = mockGet.mock.calls[1][1] as Record<string, string>
      expect(pluginParams.sysparm_fields).toContain('sys_id')
      expect(pluginParams.sysparm_fields).toContain('name')
      expect(pluginParams.sysparm_fields).toContain('id')
      expect(pluginParams.sysparm_fields).toContain('version')
      expect(pluginParams.sysparm_fields).toContain('active')
    })
  })

  describe('output formatting', () => {
    it('should show "Custom App" for sys_class_name=sys_app', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'custom-001',
                name: 'My Custom App',
                scope: 'x_my_app',
                version: '1.0.0',
                vendor: '',
                active: 'true',
                short_description: '',
                sys_class_name: 'sys_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'custom' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Custom App')
    })

    it('should show "Store App" for sys_class_name=sys_store_app', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'store-001',
                name: 'Store Application',
                scope: 'sn_store',
                version: '2.0.0',
                vendor: 'ServiceNow',
                active: 'true',
                short_description: '',
                sys_class_name: 'sys_store_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'store' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Store App')
    })

    it('should show Plugin ID for plugins', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'plugin-001',
                name: 'Test Plugin',
                id: 'com.test.plugin',
                version: '1.0.0',
                active: 'true',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Plugin ID: com.test.plugin')
    })

    it('should include tip about execute_script when apps are found', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'app-001',
                name: 'Some App',
                scope: 'x_some',
                version: '1.0.0',
                vendor: '',
                active: 'true',
                short_description: '',
                sys_class_name: 'sys_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'some' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('execute_script')
      expect(text).toContain('scope')
    })

    it('should show no-results message when nothing found', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'nonexistent_xyz' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('No applications or plugins matched')
      expect(text).toContain('Found: 0 result(s)')
      expect(text).not.toContain('execute_script')
    })

    it('should truncate long descriptions to 120 characters', async () => {
      const longDesc = 'A'.repeat(200)
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'app-long',
                name: 'Long Desc App',
                scope: 'x_long',
                version: '1.0.0',
                vendor: '',
                active: 'true',
                short_description: longDesc,
                sys_class_name: 'sys_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'long' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('A'.repeat(120) + '...')
      expect(text).not.toContain('A'.repeat(121))
    })

    it('should omit vendor when empty', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'app-novendor',
                name: 'No Vendor App',
                scope: 'x_novendor',
                version: '1.0.0',
                vendor: '',
                active: 'true',
                short_description: '',
                sys_class_name: 'sys_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'novendor' },
      })

      const text = (result.content as any[])[0].text
      expect(text).not.toContain('Vendor:')
    })

    it('should show vendor when present', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: {
            result: [
              {
                sys_id: 'app-vendor',
                name: 'Vendor App',
                scope: 'x_vendor',
                version: '1.0.0',
                vendor: 'Acme Corp',
                active: 'true',
                short_description: '',
                sys_class_name: 'sys_store_app',
              },
            ],
          },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'vendor' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Vendor: Acme Corp')
    })
  })

  describe('error handling', () => {
    it('should return isError when withConnectionRetry throws', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error looking up applications')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when sys_scope query returns non-200', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: null,
          status: 403,
          statusText: 'Forbidden',
        })
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error querying applications')
      expect(text).toContain('403')
    })

    it('should return isError when sys_plugins query returns non-200', async () => {
      mockGet
        .mockResolvedValueOnce({
          bodyObject: { result: [] },
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          bodyObject: null,
          status: 500,
          statusText: 'Internal Server Error',
        })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error querying plugins')
      expect(text).toContain('500')
    })

    it('should return isError when TableAPIRequest.get throws', async () => {
      mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
        return operation({})
      })
      mockGet.mockRejectedValue(new Error('Network error'))

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error looking up applications')
    })

    it('should check isRetryableResponse for both queries', async () => {
      // Make isRetryableResponse return true for the scope response
      mockIsRetryableResponse.mockReturnValue(true)
      mockGet.mockResolvedValue({
        bodyObject: null,
        status: undefined,
        statusText: undefined,
      })

      // withConnectionRetry should propagate the thrown error
      mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
        try {
          return await operation({})
        } catch (error) {
          throw error
        }
      })

      const result = await client.callTool({
        name: 'lookup_app',
        arguments: { search_term: 'test' },
      })

      expect(result.isError).toBe(true)
      expect(mockIsRetryableResponse).toHaveBeenCalled()
    })
  })
})
