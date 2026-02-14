import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockExecuteScript = jest.fn<(...args: any[]) => Promise<any>>()
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  BackgroundScriptExecutor: jest.fn().mockImplementation(() => ({
    executeScript: mockExecuteScript,
  })),
}))

// Dynamic import after mocks (required for ESM)
const { registerExecuteScriptTool } = await import('../../../src/tools/execute-script.js')

describe('execute_script tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()

    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerExecuteScriptTool(server)

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
      expect(names).toContain('execute_script')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'execute_script')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('script')
      expect(props).toHaveProperty('scope')
      expect(props).toHaveProperty('params')
    })

    it('should not require instance (it is optional)', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'execute_script')!
      expect(tool.inputSchema.required).toContain('script')
      expect(tool.inputSchema.required).not.toContain('instance')
    })
  })

  describe('script execution', () => {
    it('should execute a script and return output lines', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [
          { line: 'Hello from ServiceNow', },
          { line: 'Record count: 42', },
        ],
        affectedRecords: null,
      })

      const result = await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: 'gs.print("Hello from ServiceNow");',
          scope: 'global',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Hello from ServiceNow')
      expect(text).toContain('Record count: 42')
    })

    it('should pass the instance alias to getServiceNowInstance', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [{ line: 'ok' }],
      })

      await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev224436',
          script: 'gs.print("test");',
        },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('dev224436', expect.any(Function))
    })

    it('should pass undefined when instance is not provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [{ line: 'ok' }],
      })

      await client.callTool({
        name: 'execute_script',
        arguments: {
          script: 'gs.print("test");',
        },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith(undefined, expect.any(Function))
    })

    it('should default scope to global', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [{ line: 'ok' }],
      })

      await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: 'gs.print("test");',
        },
      })

      // BackgroundScriptExecutor is constructed with (instance, scope)
      const { BackgroundScriptExecutor } = await import('@sonisoft/now-sdk-ext-core')
      expect(BackgroundScriptExecutor).toHaveBeenCalledWith(
        expect.anything(),
        'global'
      )
    })
  })

  describe('parameter substitution', () => {
    it('should replace {placeholders} with param values', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [{ line: 'Found 5 records' }],
      })

      await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: 'var gr = new GlideRecord("{table}"); gr.addQuery("{field}", "{value}");',
          scope: 'global',
          params: { table: 'incident', field: 'priority', value: '1' },
        },
      })

      const calledScript = mockExecuteScript.mock.calls[0][0]
      expect(calledScript).toContain('incident')
      expect(calledScript).toContain('priority')
      expect(calledScript).not.toContain('{table}')
      expect(calledScript).not.toContain('{field}')
    })

    it('should pass script unchanged when no params are provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [{ line: 'ok' }],
      })

      const originalScript = 'gs.print("hello");'
      await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: originalScript,
          scope: 'global',
        },
      })

      const calledScript = mockExecuteScript.mock.calls[0][0]
      expect(calledScript).toBe(originalScript)
    })
  })

  describe('output formatting', () => {
    it('should include affected records when present', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [{ line: 'Updated records' }],
        affectedRecords: '3',
      })

      const result = await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: '...',
          scope: 'global',
        },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Affected Records: 3')
    })

    it('should return a helpful message when script produces no output', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: null,
      })

      const result = await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: 'var x = 1;',
          scope: 'global',
        },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('no output')
      expect(text).toContain('gs.print()')
    })

    it('should filter out empty lines from output', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockResolvedValue({
        scriptResults: [
          { line: 'line one' },
          { line: '' },
          { line: '   ' },
          { line: 'line two' },
        ],
      })

      const result = await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: '...',
          scope: 'global',
        },
      })

      const text = (result.content as any[])[0].text
      expect(text).toBe('line one\nline two')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad-alias"')
      )

      const result = await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'bad-alias',
          script: 'gs.print("test");',
          scope: 'global',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error executing script')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when script execution fails', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteScript.mockRejectedValue(
        new Error('Script Execution Request resulted in 403')
      )

      const result = await client.callTool({
        name: 'execute_script',
        arguments: {
          instance: 'dev12345',
          script: 'gs.print("test");',
          scope: 'global',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error executing script')
      expect(text).toContain('403')
    })
  })
})
