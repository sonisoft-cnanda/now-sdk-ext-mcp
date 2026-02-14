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
const { registerLookupColumnsTool } = await import('../../../src/tools/lookup-columns.js')

describe('lookup_columns tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })
    mockIsRetryableResponse.mockReturnValue(false)

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerLookupColumnsTool(server)

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
      expect(names).toContain('lookup_columns')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'lookup_columns')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('table')
      expect(props).toHaveProperty('search_term')
      expect(props).toHaveProperty('limit')
    })

    it('should require table but not instance or search_term', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'lookup_columns')!
      expect(tool.inputSchema.required).toContain('table')
      expect(tool.inputSchema.required).not.toContain('instance')
      expect(tool.inputSchema.required).not.toContain('search_term')
    })
  })

  describe('query construction', () => {
    it('should query sys_dictionary table', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      expect(mockGet).toHaveBeenCalledWith('sys_dictionary', expect.any(Object))
    })

    it('should filter by table name and exclude collection type', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      const q = queryParams.sysparm_query
      expect(q).toContain('name=incident')
      expect(q).toContain('internal_type!=collection')
    })

    it('should use ^NQ for search_term matching on element and column_label', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident', search_term: 'assign' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      const q = queryParams.sysparm_query
      expect(q).toContain('elementLIKEassign')
      expect(q).toContain('^NQ')
      expect(q).toContain('column_labelLIKEassign')
    })

    it('should not include ^NQ when no search_term', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      const q = queryParams.sysparm_query
      expect(q).not.toContain('^NQ')
      expect(q).toBe('name=incident^internal_type!=collection^ORDERBYelement')
    })

    it('should order results by element', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_query).toContain('^ORDERBYelement')
    })

    it('should request the correct fields', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_fields).toContain('element')
      expect(queryParams.sysparm_fields).toContain('column_label')
      expect(queryParams.sysparm_fields).toContain('internal_type')
      expect(queryParams.sysparm_fields).toContain('reference')
      expect(queryParams.sysparm_fields).toContain('mandatory')
    })

    it('should use sysparm_display_value "all"', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
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
        name: 'lookup_columns',
        arguments: { table: 'incident', limit: 100 },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, any>
      expect(queryParams.sysparm_limit).toBe(100)
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident', instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('dev224436', expect.any(Function))
    })
  })

  describe('output formatting', () => {
    it('should show column element, label, type, and metadata', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              element: 'assigned_to',
              column_label: 'Assigned to',
              internal_type: { display_value: 'Reference', value: 'reference' },
              max_length: '32',
              reference: { display_value: 'User [sys_user]', value: 'sys_user' },
              mandatory: { display_value: 'false', value: 'false' },
              active: { display_value: 'true', value: 'true' },
              read_only: { display_value: 'false', value: 'false' },
              default_value: '',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('assigned_to (Assigned to)')
      expect(text).toContain('Type: Reference')
      expect(text).toContain('-> User [sys_user]')
      expect(text).toContain('Mandatory: false')
      expect(text).toContain('Read-only: false')
      expect(text).toContain('Active: true')
      expect(text).toContain('Max length: 32')
    })

    it('should show table name in header', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Columns for table: incident')
    })

    it('should show search term in header when provided', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident', search_term: 'assign' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Search: "assign"')
    })

    it('should show multiple columns', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              element: 'assigned_to',
              column_label: 'Assigned to',
              internal_type: { display_value: 'Reference', value: 'reference' },
              max_length: '32',
              reference: { display_value: 'sys_user', value: 'sys_user' },
              mandatory: { display_value: 'false', value: 'false' },
              active: { display_value: 'true', value: 'true' },
              read_only: { display_value: 'false', value: 'false' },
              default_value: '',
            },
            {
              element: 'assignment_group',
              column_label: 'Assignment group',
              internal_type: { display_value: 'Reference', value: 'reference' },
              max_length: '32',
              reference: { display_value: 'sys_user_group', value: 'sys_user_group' },
              mandatory: { display_value: 'false', value: 'false' },
              active: { display_value: 'true', value: 'true' },
              read_only: { display_value: 'false', value: 'false' },
              default_value: '',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident', search_term: 'assign' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('1. assigned_to (Assigned to)')
      expect(text).toContain('2. assignment_group (Assignment group)')
      expect(text).toContain('Found: 2 column(s)')
    })

    it('should show non-reference type without arrow', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              element: 'short_description',
              column_label: 'Short description',
              internal_type: { display_value: 'String', value: 'string' },
              max_length: '160',
              reference: { display_value: '', value: '' },
              mandatory: { display_value: 'false', value: 'false' },
              active: { display_value: 'true', value: 'true' },
              read_only: { display_value: 'false', value: 'false' },
              default_value: '',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Type: String')
      expect(text).not.toContain('->')
    })

    it('should show default value when present', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              element: 'priority',
              column_label: 'Priority',
              internal_type: { display_value: 'Integer', value: 'integer' },
              max_length: '40',
              reference: { display_value: '', value: '' },
              mandatory: { display_value: 'false', value: 'false' },
              active: { display_value: 'true', value: 'true' },
              read_only: { display_value: 'false', value: 'false' },
              default_value: '4',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Default: 4')
    })

    it('should show "No columns found" with search_term guidance', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident', search_term: 'nonexistent_xyz' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('No columns matching "nonexistent_xyz"')
      expect(text).toContain('incident')
    })

    it('should show "No columns found" with table verification guidance when no search_term', async () => {
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'fake_table_xyz' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('No columns found for table "fake_table_xyz"')
      expect(text).toContain('lookup_table')
    })

    it('should include tip about element names', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              element: 'priority',
              column_label: 'Priority',
              internal_type: { display_value: 'Integer', value: 'integer' },
              max_length: '40',
              reference: { display_value: '', value: '' },
              mandatory: { display_value: 'false', value: 'false' },
              active: { display_value: 'true', value: 'true' },
              read_only: { display_value: 'false', value: 'false' },
              default_value: '',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('element names')
      expect(text).toContain('query_table')
    })

    it('should handle plain string fields (non-display-value objects)', async () => {
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              element: 'state',
              column_label: 'State',
              internal_type: 'integer',
              max_length: '40',
              reference: '',
              mandatory: 'false',
              active: 'true',
              read_only: 'false',
              default_value: '1',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('state (State)')
      expect(text).toContain('Type: integer')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error looking up columns')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when API returns non-200 status', async () => {
      mockGet.mockResolvedValue({
        bodyObject: null,
        status: 403,
        statusText: 'Forbidden',
      })

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('HTTP 403')
      expect(text).toContain('Forbidden')
    })

    it('should return isError when TableAPIRequest.get throws', async () => {
      mockGet.mockRejectedValue(new Error('Network error'))

      const result = await client.callTool({
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error looking up columns')
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
        name: 'lookup_columns',
        arguments: { table: 'incident' },
      })

      expect(mockIsRetryableResponse).toHaveBeenCalled()
      expect(result.isError).toBe(true)
    })
  })
})
