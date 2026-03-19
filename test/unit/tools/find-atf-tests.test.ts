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
const { registerFindAtfTestsTool } = await import('../../../src/tools/find-atf-tests.js')

describe('find_atf_tests tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })
    mockIsRetryableResponse.mockReturnValue(false)

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerFindAtfTestsTool(server)

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
      expect(names).toContain('find_atf_tests')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'find_atf_tests')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('search_term')
      expect(props).toHaveProperty('category')
      expect(props).toHaveProperty('active')
      expect(props).toHaveProperty('limit')
    })

    it('should not require any parameters (all optional or have defaults)', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'find_atf_tests')!
      expect(tool.inputSchema.required ?? []).not.toContain('search_term')
      expect(tool.inputSchema.required ?? []).not.toContain('instance')
    })
  })

  describe('test search', () => {
    it('should query sys_atf_test table and return formatted results', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            {
              sys_id: 'test-001',
              name: 'Validate Incident Creation',
              description: 'Tests that incidents are created correctly',
              active: 'true',
              category: 'Custom',
            },
            {
              sys_id: 'test-002',
              name: 'Incident Priority Check',
              description: 'Verifies priority escalation',
              active: 'true',
              category: 'Custom',
            },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'find_atf_tests',
        arguments: { search_term: 'incident' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Validate Incident Creation')
      expect(text).toContain('test-001')
      expect(text).toContain('Incident Priority Check')
      expect(text).toContain('test-002')
      expect(text).toContain('Found: 2 test(s)')
      expect(text).toContain('run_atf_test')

      // Verify it queried sys_atf_test
      expect(mockGet).toHaveBeenCalledWith('sys_atf_test', expect.any(Object))
    })

    it('should include search_term in encoded query using LIKE', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: { search_term: 'incident' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      const encodedQuery = queryParams.sysparm_query
      expect(encodedQuery).toContain('nameLIKEincident')
      expect(encodedQuery).toContain('descriptionLIKEincident')
      // Should use ^NQ for OR grouping
      expect(encodedQuery).toContain('^NQ')
    })

    it('should include category in encoded query when provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: { category: 'Custom' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_query).toContain('category=Custom')
    })

    it('should default active filter to true', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: {},
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_query).toContain('active=true')
    })

    it('should pass active=false when specified', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: { active: false },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_query).toContain('active=false')
    })

    it('should order results by name', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: {},
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_query).toContain('ORDERBYname')
    })

    it('should request specific fields for ATF test records', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: {},
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      expect(queryParams.sysparm_fields).toContain('sys_id')
      expect(queryParams.sysparm_fields).toContain('name')
      expect(queryParams.sysparm_fields).toContain('description')
    })
  })

  describe('encoded query construction', () => {
    it('should build correct query for search_term + category', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: { search_term: 'test', category: 'Module' },
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      const q = queryParams.sysparm_query
      // Both OR branches should include active and category
      expect(q).toContain('active=true^nameLIKEtest^category=Module')
      expect(q).toContain('^NQactive=true^descriptionLIKEtest^category=Module')
    })

    it('should build simple query when no search_term is provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      await client.callTool({
        name: 'find_atf_tests',
        arguments: {},
      })

      const queryParams = mockGet.mock.calls[0][1] as Record<string, string>
      const q = queryParams.sysparm_query
      expect(q).toBe('active=true^ORDERBYname')
    })
  })

  describe('output formatting', () => {
    it('should truncate long descriptions to 100 characters', async () => {
      // withConnectionRetry uses default mock implementation
      const longDesc = 'A'.repeat(150)
      mockGet.mockResolvedValue({
        bodyObject: {
          result: [
            { sys_id: 'test-001', name: 'Long Desc Test', description: longDesc, active: 'true' },
          ],
        },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'find_atf_tests',
        arguments: {},
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('A'.repeat(100) + '...')
      expect(text).not.toContain('A'.repeat(101))
    })

    it('should show "No ATF tests found" when result is empty', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'find_atf_tests',
        arguments: { search_term: 'nonexistent' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('No ATF tests found')
      expect(text).not.toContain('run_atf_test')
    })

    it('should include search info in header', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: { result: [] },
        status: 200,
        statusText: 'OK',
      })

      const result = await client.callTool({
        name: 'find_atf_tests',
        arguments: { search_term: 'mytest', category: 'Custom' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Search: "mytest"')
      expect(text).toContain('Category: "Custom"')
      expect(text).toContain('Active: true')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'find_atf_tests',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error finding ATF tests')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when table API fails', async () => {
      // withConnectionRetry uses default mock implementation
      mockGet.mockResolvedValue({
        bodyObject: null,
        status: 403,
        statusText: 'Forbidden',
      })

      const result = await client.callTool({
        name: 'find_atf_tests',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error searching ATF tests')
      expect(text).toContain('HTTP 403')
    })
  })
})
