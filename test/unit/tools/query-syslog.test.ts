import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockQuerySyslog = jest.fn<(...args: any[]) => Promise<any>>()
const mockQuerySyslogAppScope = jest.fn<(...args: any[]) => Promise<any>>()
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  SyslogReader: jest.fn().mockImplementation(() => ({
    querySyslog: mockQuerySyslog,
    querySyslogAppScope: mockQuerySyslogAppScope,
  })),
}))

// Dynamic import after mocks (required for ESM)
const { registerQuerySyslogTool } = await import('../../../src/tools/query-syslog.js')

describe('query_syslog tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerQuerySyslogTool(server)

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
      expect(names).toContain('query_syslog')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'query_syslog')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('query')
      expect(props).toHaveProperty('level')
      expect(props).toHaveProperty('source')
      expect(props).toHaveProperty('limit')
      expect(props).toHaveProperty('table')
    })

    it('should not require any parameters', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'query_syslog')!
      expect(tool.inputSchema.required ?? []).toEqual([])
    })
  })

  describe('syslog querying', () => {
    it('should call querySyslog for the default syslog table', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([
        {
          sys_id: 'log-1',
          sys_created_on: '2024-01-15 10:00:00',
          level: 'error',
          message: 'Script error in incident_before',
          source: 'sys_script',
        },
      ])

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: {},
      })

      expect(result.isError).toBeFalsy()
      expect(mockQuerySyslog).toHaveBeenCalled()
      expect(mockQuerySyslogAppScope).not.toHaveBeenCalled()

      const text = (result.content as any[])[0].text
      expect(text).toContain('Table: syslog')
      expect(text).toContain('Script error in incident_before')
      expect(text).toContain('ERROR')
      expect(text).toContain('sys_script')
    })

    it('should call querySyslogAppScope for syslog_app_scope table', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslogAppScope.mockResolvedValue([
        {
          sys_id: 'log-1',
          sys_created_on: '2024-01-15 10:00:00',
          level: 'error',
          message: 'Scoped app error',
          source: 'sys_script',
          app_scope: 'x_myapp',
        },
      ])

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: { table: 'syslog_app_scope' },
      })

      expect(result.isError).toBeFalsy()
      expect(mockQuerySyslogAppScope).toHaveBeenCalled()
      expect(mockQuerySyslog).not.toHaveBeenCalled()

      const text = (result.content as any[])[0].text
      expect(text).toContain('Table: syslog_app_scope')
      expect(text).toContain('x_myapp')
    })

    it('should include level filter in encoded query', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      await client.callTool({
        name: 'query_syslog',
        arguments: { level: 'error' },
      })

      const encodedQuery = mockQuerySyslog.mock.calls[0][0] as string
      expect(encodedQuery).toContain('level=error')
    })

    it('should include source filter in encoded query', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      await client.callTool({
        name: 'query_syslog',
        arguments: { source: 'sys_script' },
      })

      const encodedQuery = mockQuerySyslog.mock.calls[0][0] as string
      expect(encodedQuery).toContain('source=sys_script')
    })

    it('should include custom query in encoded query', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      await client.callTool({
        name: 'query_syslog',
        arguments: { query: 'messageLIKEtimeout' },
      })

      const encodedQuery = mockQuerySyslog.mock.calls[0][0] as string
      expect(encodedQuery).toContain('messageLIKEtimeout')
    })

    it('should combine multiple filters with ^ separator', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      await client.callTool({
        name: 'query_syslog',
        arguments: {
          query: 'messageLIKEerror',
          level: 'error',
          source: 'workflow',
        },
      })

      const encodedQuery = mockQuerySyslog.mock.calls[0][0] as string
      expect(encodedQuery).toContain('messageLIKEerror^level=error^source=workflow')
    })

    it('should always append ORDERBYDESCsys_created_on', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      await client.callTool({
        name: 'query_syslog',
        arguments: {},
      })

      const encodedQuery = mockQuerySyslog.mock.calls[0][0] as string
      expect(encodedQuery).toContain('ORDERBYDESCsys_created_on')
    })

    it('should pass limit to the query method', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      await client.callTool({
        name: 'query_syslog',
        arguments: { limit: 100 },
      })

      expect(mockQuerySyslog).toHaveBeenCalledWith(expect.any(String), 100)
    })

    it('should use default limit of 50', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      await client.callTool({
        name: 'query_syslog',
        arguments: {},
      })

      expect(mockQuerySyslog).toHaveBeenCalledWith(expect.any(String), 50)
    })
  })

  describe('output formatting', () => {
    it('should format entries as log lines with timestamp, level, source, message', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([
        {
          sys_id: 'log-1',
          sys_created_on: '2024-01-15 10:23:45',
          level: 'error',
          message: 'Script execution failed',
          source: 'sys_script',
        },
        {
          sys_id: 'log-2',
          sys_created_on: '2024-01-15 10:22:31',
          level: 'warning',
          message: 'Deprecated API called',
          source: 'workflow',
        },
      ])

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: {},
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('[2024-01-15 10:23:45] ERROR | sys_script | Script execution failed')
      expect(text).toContain('[2024-01-15 10:22:31] WARNING | workflow | Deprecated API called')
      expect(text).toContain('2 entries returned')
    })

    it('should show "No syslog entries found" when result is empty', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: {},
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('No syslog entries found')
    })

    it('should include app_scope for syslog_app_scope records', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslogAppScope.mockResolvedValue([
        {
          sys_id: 'log-1',
          sys_created_on: '2024-01-15 10:00:00',
          level: 'error',
          message: 'App error',
          source: 'sys_script',
          app_scope: 'x_myapp_custom',
        },
      ])

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: { table: 'syslog_app_scope' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('sys_script (x_myapp_custom)')
    })

    it('should show filter info in header', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockResolvedValue([])

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: { level: 'error', source: 'workflow' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Level: error')
      expect(text).toContain('Source: workflow')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error querying syslog')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when SyslogReader throws', async () => {
      // withConnectionRetry uses default mock implementation
      mockQuerySyslog.mockRejectedValue(
        new Error('Failed to query syslog table. Status: 500')
      )

      const result = await client.callTool({
        name: 'query_syslog',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error querying syslog')
      expect(text).toContain('Status: 500')
    })
  })
})
