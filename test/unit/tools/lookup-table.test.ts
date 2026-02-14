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
const { registerLookupTableTool } = await import('../../../src/tools/lookup-table.js')

describe('lookup_table tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })
    mockIsRetryableResponse.mockReturnValue(false)

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerLookupTableTool(server)

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
      expect(names).toContain('lookup_table')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'lookup_table')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('search_term')
      expect(props).toHaveProperty('limit')
    })

    it('should require search_term', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'lookup_table')!
      expect(tool.inputSchema.required).toContain('search_term')
      expect(tool.inputSchema.required).not.toContain('instance')
    })
  })

  describe('query construction', () => {
    it('should use LIKE matching on name and label with ^NQ', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      const q = queryParams.sysparm_query
      expect(q).toContain('nameLIKEincident')
      expect(q).toContain('^NQ')
      expect(q).toContain('labelLIKEincident')
    })

    it('should order results by name', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_query).toContain('^ORDERBYname')
    })

    it('should query sys_db_object table', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      expect(mockGet).toHaveBeenCalledWith('sys_db_object', expect.any(Object))
    })

    it('should request the correct fields', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_fields).toContain('sys_id')
      expect(queryParams.sysparm_fields).toContain('name')
      expect(queryParams.sysparm_fields).toContain('label')
      expect(queryParams.sysparm_fields).toContain('super_class')
      expect(queryParams.sysparm_fields).toContain('is_extendable')
    })

    it('should use sysparm_display_value "all"', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_display_value).toBe('all')
    })

    it('should pass the limit parameter', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident', limit: 10 },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, any>
      expect(queryParams.sysparm_limit).toBe(10)
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident', instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('dev224436', expect.any(Function))
    })
  })

  describe('output formatting', () => {
    it('should show table name, label, parent, and metadata', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              sys_id: 'abc123',
              name: 'incident',
              label: 'Incident',
              super_class: { display_value: 'Task', value: 'task-sys-id' },
              is_extendable: { display_value: 'true', value: 'true' },
              number_ref: { display_value: 'INC', value: 'inc-ref-id' },
              sys_scope: { display_value: 'Global', value: 'global-id' },
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('incident (Incident)')
      expect(text).toContain('sys_id: abc123')
      expect(text).toContain('Extends: Task')
      expect(text).toContain('Extendable: true')
      expect(text).toContain('Number prefix: INC')
      expect(text).toContain('Scope: Global')
      expect(text).toContain('Found: 1 table(s)')
    })

    it('should show multiple results', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              sys_id: 'abc123',
              name: 'incident',
              label: 'Incident',
              super_class: { display_value: 'Task', value: 'task-id' },
              is_extendable: { display_value: 'true', value: 'true' },
              number_ref: { display_value: 'INC', value: '' },
              sys_scope: { display_value: 'Global', value: '' },
            },
            {
              sys_id: 'def456',
              name: 'incident_alert',
              label: 'Incident Alert',
              super_class: { display_value: '', value: '' },
              is_extendable: { display_value: 'false', value: 'false' },
              number_ref: { display_value: '', value: '' },
              sys_scope: { display_value: 'Global', value: '' },
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('1. incident (Incident)')
      expect(text).toContain('2. incident_alert (Incident Alert)')
      expect(text).toContain('Found: 2 table(s)')
    })

    it('should show "No tables found" when result is empty', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'nonexistent_xyz' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Found: 0 table(s)')
      expect(text).toContain('No tables found')
    })

    it('should include tip about query_table and lookup_columns', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              sys_id: 'abc123',
              name: 'incident',
              label: 'Incident',
              super_class: { display_value: '', value: '' },
              is_extendable: { display_value: 'true', value: 'true' },
              number_ref: { display_value: '', value: '' },
              sys_scope: { display_value: '', value: '' },
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('query_table')
      expect(text).toContain('lookup_columns')
    })

    it('should handle plain string fields (non-display-value objects)', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              sys_id: 'abc123',
              name: 'my_table',
              label: 'My Table',
              super_class: '',
              is_extendable: 'false',
              number_ref: '',
              sys_scope: 'Global',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'my_table' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('my_table (My Table)')
      expect(text).toContain('Scope: Global')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error looking up tables')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when API returns non-200 status', async () => {
      mockGet.mockResolvedValue({
        bodyObject: null,
        status: 403,
        statusText: 'Forbidden',
      })

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('HTTP 403')
      expect(text).toContain('Forbidden')
    })

    it('should return isError when TableAPIRequest.get throws', async () => {
      mockGet.mockRejectedValue(new Error('Network error'))

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error looking up tables')
      expect(text).toContain('Network error')
    })

    it('should check isRetryableResponse', async () => {
      mockIsRetryableResponse.mockReturnValue(true)
      mockGet.mockResolvedValue({
        bodyObject: null,
        status: null,
        statusText: null,
      })

      const result = await client.callTool({
        name: 'lookup_table',
        arguments: { search_term: 'incident' },
      })

      expect(mockIsRetryableResponse).toHaveBeenCalled()
      // withConnectionRetry should have been called (the retry logic handles the thrown error)
      expect(result.isError).toBe(true)
    })
  })
})
