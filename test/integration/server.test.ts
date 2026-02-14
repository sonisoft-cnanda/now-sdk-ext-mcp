import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { z } from "zod"

/**
 * Integration tests for the MCP server.
 *
 * These test the full MCP protocol flow (handshake, tool listing, tool calls)
 * using InMemoryTransport. They do NOT hit real ServiceNow instances — they
 * verify that the server correctly handles the MCP protocol lifecycle.
 *
 * Tests that call real ServiceNow endpoints belong in a separate suite
 * gated behind credentials and a --testPathPattern flag.
 */

function createTestServer(): McpServer {
  const server = new McpServer({
    name: "now-sdk-ext-mcp",
    version: "1.0.0-alpha.0",
  })

  // Register a simple echo tool to test the protocol without external deps
  server.registerTool(
    "echo",
    {
      description: "Echoes back the input (test-only tool)",
      inputSchema: {
        message: z.string().describe("The message to echo"),
      },
    },
    async ({ message }) => ({
      content: [{ type: "text" as const, text: `Echo: ${message}` }],
    })
  )

  return server
}

describe('MCP Server Integration', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    server = createTestServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    client = new Client({ name: "integration-test-client", version: "1.0.0" })
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await server.close()
  })

  describe('handshake', () => {
    it('should complete the MCP initialization handshake', () => {
      const serverVersion = client.getServerVersion()
      expect(serverVersion).toBeDefined()
      expect(serverVersion!.name).toBe('now-sdk-ext-mcp')
      expect(serverVersion!.version).toBe('1.0.0-alpha.0')
    })

    it('should advertise tool capabilities', () => {
      const capabilities = client.getServerCapabilities()
      expect(capabilities).toBeDefined()
      expect(capabilities!.tools).toBeDefined()
    })
  })

  describe('tool listing', () => {
    it('should list all registered tools', async () => {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('echo')
    })

    it('should include input schema with required properties', async () => {
      const { tools } = await client.listTools()
      const echoTool = tools.find((t) => t.name === 'echo')!
      expect(echoTool.inputSchema.type).toBe('object')
      expect(echoTool.inputSchema.properties).toHaveProperty('message')
      expect(echoTool.inputSchema.required).toContain('message')
    })
  })

  describe('tool execution', () => {
    it('should execute a tool and return content', async () => {
      const result = await client.callTool({
        name: 'echo',
        arguments: { message: 'hello world' },
      })

      expect(result.content).toEqual([
        { type: 'text', text: 'Echo: hello world' },
      ])
      expect(result.isError).toBeFalsy()
    })

    it('should return an error for a non-existent tool', async () => {
      const result = await client.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('nonexistent_tool')
    })
  })

  describe('sequential calls', () => {
    it('should handle multiple tool calls on the same connection', async () => {
      const r1 = await client.callTool({
        name: 'echo',
        arguments: { message: 'first' },
      })
      const r2 = await client.callTool({
        name: 'echo',
        arguments: { message: 'second' },
      })
      const r3 = await client.callTool({
        name: 'echo',
        arguments: { message: 'third' },
      })

      expect((r1.content as any[])[0].text).toBe('Echo: first')
      expect((r2.content as any[])[0].text).toBe('Echo: second')
      expect((r3.content as any[])[0].text).toBe('Echo: third')
    })
  })
})
