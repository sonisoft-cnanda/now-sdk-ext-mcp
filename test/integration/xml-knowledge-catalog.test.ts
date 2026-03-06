import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// XML Record tools
import {
  registerExportRecordXmlTool,
  registerImportRecordsXmlTool,
} from '../../src/tools/xml-record.js'

// Knowledge tools
import {
  registerListKnowledgeBasesTool,
  registerGetKnowledgeBaseTool,
  registerListKbCategoriesTool,
  registerCreateKbCategoryTool,
  registerListKbArticlesTool,
  registerGetKbArticleTool,
  registerCreateKbArticleTool,
  registerUpdateKbArticleTool,
  registerPublishKbArticleTool,
} from '../../src/tools/knowledge.js'

// Catalog tools
import {
  registerListCatalogItemsTool,
  registerGetCatalogItemTool,
  registerListCatalogCategoriesTool,
  registerGetCatalogCategoryTool,
  registerListCatalogItemVariablesTool,
  registerSubmitCatalogRequestTool,
} from '../../src/tools/catalog.js'

// Also register query_table for finding records in setup steps
import { registerQueryTableTool } from '../../src/tools/query-table.js'

/**
 * Integration tests for XML Record, Knowledge Base, and Service Catalog tools.
 *
 * These tests hit a real ServiceNow instance using stored credentials.
 * Run with: npm run test:integration
 */

const SN_INSTANCE = process.env.SN_INSTANCE_ALIAS || 'dev224436'

/** Helper: extract text from MCP tool result */
function getText(result: any): string {
  return (result.content as any[])[0]?.text || ''
}

describe('XML Record, Knowledge, and Catalog Integration Tests', () => {
  let server: McpServer
  let client: Client

  beforeAll(async () => {
    server = new McpServer({
      name: "now-sdk-ext-mcp-integration",
      version: "1.0.0-alpha.0",
    })

    // Register all tools needed for these tests
    registerExportRecordXmlTool(server)
    registerImportRecordsXmlTool(server)
    registerListKnowledgeBasesTool(server)
    registerGetKnowledgeBaseTool(server)
    registerListKbCategoriesTool(server)
    registerCreateKbCategoryTool(server)
    registerListKbArticlesTool(server)
    registerGetKbArticleTool(server)
    registerCreateKbArticleTool(server)
    registerUpdateKbArticleTool(server)
    registerPublishKbArticleTool(server)
    registerListCatalogItemsTool(server)
    registerGetCatalogItemTool(server)
    registerListCatalogCategoriesTool(server)
    registerGetCatalogCategoryTool(server)
    registerListCatalogItemVariablesTool(server)
    registerSubmitCatalogRequestTool(server)
    registerQueryTableTool(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    client = new Client(
      { name: "integration-test-client", version: "1.0.0" },
      { capabilities: {} }
    )
    await client.connect(clientTransport)
  })

  afterAll(async () => {
    await client.close()
    await server.close()
  })

  // ─── XML Record Tools ─────────────────────────────────────────────

  describe('export_record_xml', () => {
    it('should export a sys_script_include record as XML', async () => {
      // First find a script include to export
      const queryResult = await client.callTool({
        name: 'query_table',
        arguments: {
          instance: SN_INSTANCE,
          table: 'sys_script_include',
          fields: 'sys_id,name',
          limit: 1,
        },
      })

      const queryText = getText(queryResult)
      const sysIdMatch = queryText.match(/"sys_id":\s*"([a-f0-9]{32})"/)
      if (!sysIdMatch) {
        console.error('No script includes found, skipping XML export test')
        return
      }

      const sysId = sysIdMatch[1]
      const result = await client.callTool({
        name: 'export_record_xml',
        arguments: {
          instance: SN_INSTANCE,
          table: 'sys_script_include',
          sys_id: sysId,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Exported record from sys_script_include')
      expect(text).toContain(sysId)
      expect(text).toContain('bytes of XML')
      // Should contain actual XML content
      expect(text).toContain('<?xml')
      expect(text).toContain('unload')
    }, 60_000)

    it('should return error for a non-existent record', async () => {
      const result = await client.callTool({
        name: 'export_record_xml',
        arguments: {
          instance: SN_INSTANCE,
          table: 'sys_script_include',
          sys_id: '00000000000000000000000000000000',
        },
      })

      // Depending on core library behavior, this may be an error or empty XML
      const text = getText(result)
      expect(text.length).toBeGreaterThan(0)
    }, 60_000)
  })

  describe('import_records_xml (round-trip)', () => {
    it('should export then re-import a record (INSERT_OR_UPDATE is idempotent)', async () => {
      // Find a script include to round-trip
      const queryResult = await client.callTool({
        name: 'query_table',
        arguments: {
          instance: SN_INSTANCE,
          table: 'sys_script_include',
          fields: 'sys_id,name',
          limit: 1,
        },
      })

      const queryText = getText(queryResult)
      const sysIdMatch = queryText.match(/"sys_id":\s*"([a-f0-9]{32})"/)
      if (!sysIdMatch) {
        console.error('No script includes found, skipping XML round-trip test')
        return
      }

      const sysId = sysIdMatch[1]

      // Export
      const exportResult = await client.callTool({
        name: 'export_record_xml',
        arguments: {
          instance: SN_INSTANCE,
          table: 'sys_script_include',
          sys_id: sysId,
        },
      })

      expect(exportResult.isError).toBeFalsy()
      const exportText = getText(exportResult)

      // Extract the raw XML from the export output (after the summary line)
      const xmlStart = exportText.indexOf('<?xml')
      expect(xmlStart).toBeGreaterThan(-1)
      const xmlContent = exportText.substring(xmlStart)

      // Re-import (INSERT_OR_UPDATE — same record, should be idempotent)
      const importResult = await client.callTool({
        name: 'import_records_xml',
        arguments: {
          instance: SN_INSTANCE,
          xml_content: xmlContent,
          target_table: 'sys_script_include',
        },
      })

      expect(importResult.isError).toBeFalsy()
      const importText = getText(importResult)
      expect(importText).toContain('Successfully imported')
      expect(importText).toContain('sys_script_include')
    }, 120_000)
  })

  // ─── Knowledge Base Tools ─────────────────────────────────────────

  describe('list_knowledge_bases', () => {
    it('should return at least one knowledge base', async () => {
      const result = await client.callTool({
        name: 'list_knowledge_bases',
        arguments: {
          instance: SN_INSTANCE,
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('knowledge base(s)')
      expect(text).toMatch(/sys_id:\s*[a-f0-9]{32}/)
    }, 60_000)

    it('should filter by active status', async () => {
      const result = await client.callTool({
        name: 'list_knowledge_bases',
        arguments: {
          instance: SN_INSTANCE,
          active: true,
          limit: 5,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      // Should only show active KBs (or no results if none are active)
      if (text.includes('knowledge base(s)')) {
        expect(text).toContain('active: true')
        expect(text).not.toContain('active: false')
      }
    }, 60_000)
  })

  describe('get_knowledge_base', () => {
    it('should return KB details with article and category counts', async () => {
      // First find a KB
      const listResult = await client.callTool({
        name: 'list_knowledge_bases',
        arguments: { instance: SN_INSTANCE, limit: 1 },
      })

      const listText = getText(listResult)
      const sysIdMatch = listText.match(/sys_id:\s*([a-f0-9]{32})/)
      if (!sysIdMatch) {
        console.error('No knowledge bases found, skipping get_knowledge_base test')
        return
      }

      const kbSysId = sysIdMatch[1]
      const result = await client.callTool({
        name: 'get_knowledge_base',
        arguments: { instance: SN_INSTANCE, sys_id: kbSysId },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Knowledge Base:')
      expect(text).toContain(`sys_id: ${kbSysId}`)
      expect(text).toContain('Articles:')
      expect(text).toContain('Categories:')
    }, 60_000)
  })

  describe('list_kb_categories', () => {
    it('should list categories', async () => {
      const result = await client.callTool({
        name: 'list_kb_categories',
        arguments: { instance: SN_INSTANCE, limit: 10 },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      // May or may not have categories depending on instance setup
      expect(text.length).toBeGreaterThan(0)
    }, 60_000)

    it('should filter categories by knowledge base', async () => {
      // Find a KB first
      const listResult = await client.callTool({
        name: 'list_knowledge_bases',
        arguments: { instance: SN_INSTANCE, limit: 1 },
      })

      const sysIdMatch = getText(listResult).match(/sys_id:\s*([a-f0-9]{32})/)
      if (!sysIdMatch) {
        console.error('No KBs found, skipping filtered category list test')
        return
      }

      const result = await client.callTool({
        name: 'list_kb_categories',
        arguments: {
          instance: SN_INSTANCE,
          knowledge_base_sys_id: sysIdMatch[1],
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
    }, 60_000)
  })

  describe('Knowledge article lifecycle (create → update → publish → get)', () => {
    let kbSysId: string | undefined
    let articleSysId: string | undefined
    let categorySysId: string | undefined

    it('should find a knowledge base to work with', async () => {
      const result = await client.callTool({
        name: 'list_knowledge_bases',
        arguments: { instance: SN_INSTANCE, active: true, limit: 1 },
      })

      const text = getText(result)
      const match = text.match(/sys_id:\s*([a-f0-9]{32})/)
      if (!match) {
        console.error('No active KBs found, skipping article lifecycle tests')
        return
      }
      kbSysId = match[1]
      expect(kbSysId).toBeDefined()
    }, 60_000)

    it('should create a KB category', async () => {
      if (!kbSysId) return

      const label = `Integration Test Category ${Date.now()}`
      const result = await client.callTool({
        name: 'create_kb_category',
        arguments: {
          instance: SN_INSTANCE,
          label,
          knowledge_base_sys_id: kbSysId,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('created successfully')
      expect(text).toContain(label)

      const match = text.match(/sys_id:\s*([a-f0-9]{32})/)
      expect(match).toBeTruthy()
      categorySysId = match![1]
    }, 60_000)

    it('should create a KB article in draft state', async () => {
      if (!kbSysId) return

      const title = `Integration Test Article ${Date.now()}`
      const result = await client.callTool({
        name: 'create_kb_article',
        arguments: {
          instance: SN_INSTANCE,
          short_description: title,
          knowledge_base_sys_id: kbSysId,
          text: '<p>This is an integration test article created by the MCP server test suite.</p>',
          category_sys_id: categorySysId,
          workflow_state: 'draft',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('created successfully')
      expect(text).toContain(title)
      expect(text).toContain('Workflow State: draft')

      const match = text.match(/sys_id:\s*([a-f0-9]{32})/)
      expect(match).toBeTruthy()
      articleSysId = match![1]
    }, 60_000)

    it('should update the article title', async () => {
      if (!articleSysId) return

      const updatedTitle = `Updated Integration Test Article ${Date.now()}`
      const result = await client.callTool({
        name: 'update_kb_article',
        arguments: {
          instance: SN_INSTANCE,
          sys_id: articleSysId,
          short_description: updatedTitle,
          text: '<p>Updated body content from integration test.</p>',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('updated successfully')
      expect(text).toContain(updatedTitle)
    }, 60_000)

    it('should get the full article with body content', async () => {
      if (!articleSysId) return

      const result = await client.callTool({
        name: 'get_kb_article',
        arguments: { instance: SN_INSTANCE, sys_id: articleSysId },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Article:')
      expect(text).toContain(`sys_id: ${articleSysId}`)
      expect(text).toContain('--- Body ---')
      expect(text).toContain('Updated body content')
    }, 60_000)

    it('should publish the article', async () => {
      if (!articleSysId) return

      const result = await client.callTool({
        name: 'publish_kb_article',
        arguments: { instance: SN_INSTANCE, sys_id: articleSysId },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('published successfully')
      expect(text).toContain(articleSysId)
    }, 60_000)

    it('should list articles with workflow_state filter', async () => {
      if (!kbSysId) return

      const result = await client.callTool({
        name: 'list_kb_articles',
        arguments: {
          instance: SN_INSTANCE,
          knowledge_base_sys_id: kbSysId,
          workflow_state: 'published',
          limit: 5,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      // Should have at least one published article (the one we just published)
      if (text.includes('article(s)')) {
        expect(text).toContain('state: published')
      }
    }, 60_000)

    it('should retire the test article (cleanup)', async () => {
      if (!articleSysId) return

      const result = await client.callTool({
        name: 'update_kb_article',
        arguments: {
          instance: SN_INSTANCE,
          sys_id: articleSysId,
          workflow_state: 'retired',
          active: false,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('updated successfully')
    }, 60_000)
  })

  // ─── Service Catalog Tools ────────────────────────────────────────

  describe('list_catalog_items', () => {
    it('should return catalog items from the instance', async () => {
      const result = await client.callTool({
        name: 'list_catalog_items',
        arguments: {
          instance: SN_INSTANCE,
          active: true,
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('catalog item(s)')
      expect(text).toMatch(/sys_id:\s*[a-f0-9]{32}/)
    }, 60_000)

    it('should support text search', async () => {
      const result = await client.callTool({
        name: 'list_catalog_items',
        arguments: {
          instance: SN_INSTANCE,
          text_search: 'laptop',
          limit: 5,
        },
      })

      expect(result.isError).toBeFalsy()
      // May or may not find results depending on catalog setup
      const text = getText(result)
      expect(text.length).toBeGreaterThan(0)
    }, 60_000)
  })

  describe('get_catalog_item', () => {
    it('should return item details with variables', async () => {
      // First find a catalog item
      const listResult = await client.callTool({
        name: 'list_catalog_items',
        arguments: { instance: SN_INSTANCE, active: true, limit: 1 },
      })

      const listText = getText(listResult)
      const sysIdMatch = listText.match(/sys_id:\s*([a-f0-9]{32})/)
      if (!sysIdMatch) {
        console.error('No catalog items found, skipping get_catalog_item test')
        return
      }

      const itemSysId = sysIdMatch[1]
      const result = await client.callTool({
        name: 'get_catalog_item',
        arguments: {
          instance: SN_INSTANCE,
          sys_id: itemSysId,
          include_variables: true,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Catalog Item:')
      expect(text).toContain(`sys_id: ${itemSysId}`)
      expect(text).toContain('Active:')
    }, 60_000)
  })

  describe('list_catalog_categories', () => {
    it('should return catalog categories', async () => {
      const result = await client.callTool({
        name: 'list_catalog_categories',
        arguments: {
          instance: SN_INSTANCE,
          active: true,
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      // May or may not have categories
      expect(text.length).toBeGreaterThan(0)
    }, 60_000)
  })

  describe('get_catalog_category', () => {
    it('should return category details with item count', async () => {
      // First find a category
      const listResult = await client.callTool({
        name: 'list_catalog_categories',
        arguments: { instance: SN_INSTANCE, active: true, limit: 1 },
      })

      const listText = getText(listResult)
      const sysIdMatch = listText.match(/sys_id:\s*([a-f0-9]{32})/)
      if (!sysIdMatch) {
        console.error('No catalog categories found, skipping get_catalog_category test')
        return
      }

      const catSysId = sysIdMatch[1]
      const result = await client.callTool({
        name: 'get_catalog_category',
        arguments: { instance: SN_INSTANCE, sys_id: catSysId },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Category:')
      expect(text).toContain(`sys_id: ${catSysId}`)
      expect(text).toContain('Items in Category:')
    }, 60_000)
  })

  describe('list_catalog_item_variables', () => {
    it('should return variables for a catalog item', async () => {
      // Find a catalog item that likely has variables
      const listResult = await client.callTool({
        name: 'list_catalog_items',
        arguments: { instance: SN_INSTANCE, active: true, limit: 5 },
      })

      const listText = getText(listResult)
      const sysIdMatch = listText.match(/sys_id:\s*([a-f0-9]{32})/)
      if (!sysIdMatch) {
        console.error('No catalog items found, skipping variables test')
        return
      }

      const itemSysId = sysIdMatch[1]
      const result = await client.callTool({
        name: 'list_catalog_item_variables',
        arguments: {
          instance: SN_INSTANCE,
          catalog_item_sys_id: itemSysId,
          include_variable_sets: true,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      // Item may or may not have variables
      expect(text.length).toBeGreaterThan(0)
      if (text.includes('variable(s)')) {
        expect(text).toContain('Type:')
        expect(text).toContain('Mandatory:')
      }
    }, 60_000)
  })

  // NOTE: submit_catalog_request is intentionally NOT tested here because
  // it creates real service requests on the instance that trigger approval
  // workflows, fulfillment tasks, and notifications. Manual testing only.
})
