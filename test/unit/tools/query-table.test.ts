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
const { registerQueryTableTool } = await import('../../../src/tools/query-table.js')

describe('query_table tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })
    mockIsRetryableResponse.mockReturnValue(false)

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerQueryTableTool(server)

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
      expect(names).toContain('query_table')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'query_table')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('table')
      expect(props).toHaveProperty('query')
      expect(props).toHaveProperty('fields')
      expect(props).toHaveProperty('limit')
      expect(props).toHaveProperty('display_value')
    })

    it('should require table but not instance', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'query_table')!
      expect(tool.inputSchema.required).toContain('table')
      expect(tool.inputSchema.required).not.toContain('instance')
    })
  })

  describe('table querying', () => {
    it('should query a table and return formatted records', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            { sys_id: 'abc', number: 'INC001', short_description: 'Test incident' },
            { sys_id: 'def', number: 'INC002', short_description: 'Another incident' },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'query_table',
        arguments: {
          table: 'incident',
          query: 'active=true',
          fields: 'sys_id,number,short_description',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Table: incident')
      expect(text).toContain('Query: active=true')
      expect(text).toContain('Fields: sys_id,number,short_description')
      expect(text).toContain('Records returned: 2')
      expect(text).toContain('INC001')
      expect(text).toContain('INC002')
      expect(text).toContain('--- Record 1 ---')
      expect(text).toContain('--- Record 2 ---')
    })

    it('should pass the instance alias to getServiceNowInstance', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident', instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('dev224436', expect.any(Function))
    })

    it('should include sysparm_query when query parameter is provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident', query: 'priority=1' },
      })

      expect(mockGet).toHaveBeenCalledWith(
        'incident',
        expect.objectContaining({ sysparm_query: 'priority=1' })
      )
    })

    it('should include sysparm_fields when fields parameter is provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident', fields: 'sys_id,number' },
      })

      expect(mockGet).toHaveBeenCalledWith(
        'incident',
        expect.objectContaining({ sysparm_fields: 'sys_id,number' })
      )
    })

    it('should set sysparm_display_value when display_value is true', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident', display_value: true },
      })

      expect(mockGet).toHaveBeenCalledWith(
        'incident',
        expect.objectContaining({ sysparm_display_value: 'true' })
      )
    })

    it('should not include sysparm_display_value when display_value is false', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, unknown>
      expect(queryParams).not.toHaveProperty('sysparm_display_value')
    })

    it('should use default limit of 20', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      expect(mockGet).toHaveBeenCalledWith(
        'incident',
        expect.objectContaining({ sysparm_limit: 20 })
      )
    })

    it('should respect custom limit parameter', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident', limit: 100 },
      })

      expect(mockGet).toHaveBeenCalledWith(
        'incident',
        expect.objectContaining({ sysparm_limit: 100 })
      )
    })
  })

  describe('output formatting', () => {
    it('should show "No records found" when result is empty', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Records returned: 0')
      expect(text).toContain('No records found matching the query.')
    })

    it('should format each record as JSON', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [{ sys_id: 'abc', name: 'Test Record' }],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      const text = (result.content as any[])[0].text
      // Verify it's valid JSON inside the output
      expect(text).toContain('"sys_id": "abc"')
      expect(text).toContain('"name": "Test Record"')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error querying table')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when API returns non-200 status', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: null,
        status: 403,
        statusText: 'Forbidden',
      })

      const result = await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('HTTP 403')
      expect(text).toContain('Forbidden')
    })

    it('should return isError when TableAPIRequest.get() throws', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockRejectedValue(new Error('Network error'))

      const result = await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error querying table')
      expect(text).toContain('Network error')
    })

    it('should handle null response from TableAPIRequest', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue(null)

      const result = await client.callTool({
        name: 'query_table',
        arguments: { table: 'incident' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error querying table')
    })
  })
})
