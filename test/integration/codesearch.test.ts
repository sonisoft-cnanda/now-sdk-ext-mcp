import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  registerCodeSearchTool,
  registerListCodeSearchGroupsTool,
  registerListCodeSearchTablesTool,
  registerAddCodeSearchTableTool,
} from '../../src/tools/codesearch.js'

/**
 * Integration tests for the code search MCP tools.
 *
 * These tests hit a real ServiceNow instance using stored credentials.
 * They require the SN_INSTANCE_ALIAS env var or a configured auth alias.
 *
 * Run with: npm run test:integration
 */

const SN_INSTANCE_ALIAS = process.env.SN_INSTANCE_ALIAS || 'dev224436'

describe('Code Search Integration Tests', () => {
  let server: McpServer
  let client: Client

  beforeAll(async () => {
    server = new McpServer({
      name: "now-sdk-ext-mcp-integration",
      version: "1.0.0-alpha.0",
    })

    // Register all code search tools (no mocking — real ServiceNow calls)
    registerCodeSearchTool(server)
    registerListCodeSearchGroupsTool(server)
    registerListCodeSearchTablesTool(server)
    registerAddCodeSearchTableTool(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    client = new Client({ name: "integration-test-client", version: "1.0.0" })
    await client.connect(clientTransport)
  })

  afterAll(async () => {
    await client.close()
    await server.close()
  })

  describe('list_code_search_groups', () => {
    it('should return at least one search group from the instance', async () => {
      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: { instance: SN_INSTANCE_ALIAS },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Code Search Groups')
      // Every instance should have at least one search group
      expect(text).not.toContain('Found: 0 group(s)')
    }, 60_000)
  })

  describe('code_search', () => {
    it('should return results when searching for a common term like "GlideRecord"', async () => {
      const result = await client.callTool({
        name: 'code_search',
        arguments: {
          term: 'GlideRecord',
          instance: SN_INSTANCE_ALIAS,
          limit: 5,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Code Search Results')
      expect(text).toContain('Search: "GlideRecord"')
      // GlideRecord is ubiquitous — should return results
      expect(text).not.toContain('No results found.')
    }, 60_000)

    it('should return no results for a nonsensical search term', async () => {
      const result = await client.callTool({
        name: 'code_search',
        arguments: {
          term: 'xyzzy_nonexistent_9876543210_zzz',
          instance: SN_INSTANCE_ALIAS,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('No results found.')
    }, 60_000)
  })

  describe('list_code_search_tables', () => {
    it('should list tables for a valid search group', async () => {
      // First, get a valid search group name
      const groupsResult = await client.callTool({
        name: 'list_code_search_groups',
        arguments: { instance: SN_INSTANCE_ALIAS },
      })

      const groupText = (groupsResult.content as any[])[0].text

      // Extract the first group name (appears after "1. " in the output)
      const nameMatch = groupText.match(/1\.\s+(.+)\n/)
      if (!nameMatch) {
        // Skip if no groups found (unlikely but possible)
        console.error('No search groups found, skipping list_code_search_tables test')
        return
      }

      const groupName = nameMatch[1].trim()

      const result = await client.callTool({
        name: 'list_code_search_tables',
        arguments: {
          search_group: groupName,
          instance: SN_INSTANCE_ALIAS,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Tables in Search Group')
      expect(text).toContain(groupName)
      // A valid search group should have at least one table
      expect(text).not.toContain('Found: 0 table(s)')
    }, 60_000)
  })
})
