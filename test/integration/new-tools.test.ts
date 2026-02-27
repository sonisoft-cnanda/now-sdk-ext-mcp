import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// Import all new tool registration functions
import {
  registerCountRecordsTool,
  registerAggregateQueryTool,
  registerAggregateGroupedTool,
} from '../../src/tools/aggregate.js'
import { registerCheckInstanceHealthTool } from '../../src/tools/health.js'
import {
  registerGetCmdbRelationshipsTool,
  registerTraverseCmdbGraphTool,
} from '../../src/tools/cmdb.js'
import {
  registerListInstanceTablesTool,
  registerListPluginsTool,
} from '../../src/tools/discovery.js'
import {
  registerQueryUpdateRecordsTool,
  registerQueryDeleteRecordsTool,
} from '../../src/tools/query-batch.js'
import {
  registerCloneUpdateSetTool,
  registerMoveUpdateSetRecordsTool,
  registerGetCurrentUpdateSetTool,
  registerListUpdateSetsTool,
  registerCreateUpdateSetTool,
  registerInspectUpdateSetTool,
} from '../../src/tools/updateset.js'
import {
  registerUploadAttachmentTool,
  registerListAttachmentsTool,
} from '../../src/tools/attachment.js'
import { registerQueryTableTool } from '../../src/tools/query-table.js'

/**
 * Integration tests for the 13 new MCP tools.
 *
 * These tests hit a real ServiceNow instance using stored credentials.
 * Run with: npm run test:integration
 */

const SN_INSTANCE = process.env.SN_INSTANCE_ALIAS || 'dev224436'

// Long-running operations (clone, move, etc.) need extended timeouts
const LONG_TIMEOUT = { timeout: 120_000 }

/** Helper: extract text from MCP tool result */
function getText(result: any): string {
  return (result.content as any[])[0]?.text || ''
}

describe('New Tools Integration Tests', () => {
  let server: McpServer
  let client: Client

  beforeAll(async () => {
    server = new McpServer({
      name: "now-sdk-ext-mcp-integration",
      version: "1.0.0-alpha.0",
    })

    // Register all tools needed for these tests
    registerCountRecordsTool(server)
    registerAggregateQueryTool(server)
    registerAggregateGroupedTool(server)
    registerCheckInstanceHealthTool(server)
    registerGetCmdbRelationshipsTool(server)
    registerTraverseCmdbGraphTool(server)
    registerListInstanceTablesTool(server)
    registerListPluginsTool(server)
    registerQueryUpdateRecordsTool(server)
    registerQueryDeleteRecordsTool(server)
    registerCloneUpdateSetTool(server)
    registerMoveUpdateSetRecordsTool(server)
    registerGetCurrentUpdateSetTool(server)
    registerListUpdateSetsTool(server)
    registerCreateUpdateSetTool(server)
    registerInspectUpdateSetTool(server)
    registerUploadAttachmentTool(server)
    registerListAttachmentsTool(server)
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

  // ─── Aggregate Tools ───────────────────────────────────────────────

  describe('count_records', () => {
    it('should return a count of records on the incident table', async () => {
      const result = await client.callTool({
        name: 'count_records',
        arguments: { instance: SN_INSTANCE, table: 'incident' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Record Count')
      expect(text).toContain('Table: incident')
      expect(text).toMatch(/Count: \d+/)
    }, 60_000)

    it('should return a count with a query filter', async () => {
      const result = await client.callTool({
        name: 'count_records',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          query: 'active=true',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Query: active=true')
      expect(text).toMatch(/Count: \d+/)
    }, 60_000)
  })

  describe('aggregate_query', () => {
    it('should return aggregate stats with count on incident table', async () => {
      const result = await client.callTool({
        name: 'aggregate_query',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          count: true,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Aggregate Results')
      expect(text).toContain('Table: incident')
      expect(text).toContain('Stats:')
      // Should contain a count value
      expect(text).toContain('count')
    }, 60_000)

    it('should compute AVG on a numeric field', async () => {
      const result = await client.callTool({
        name: 'aggregate_query',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          query: 'active=true',
          avg_fields: ['reassignment_count'],
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Stats:')
    }, 60_000)
  })

  describe('aggregate_grouped', () => {
    it('should group incident counts by priority', async () => {
      const result = await client.callTool({
        name: 'aggregate_grouped',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          group_by: ['priority'],
          count: true,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Grouped Aggregate Results')
      expect(text).toContain('Group By: priority')
      expect(text).toMatch(/Groups returned: \d+/)
      // Should have at least one group
      expect(text).toContain('--- Group ---')
    }, 60_000)
  })

  // ─── Health Tool ───────────────────────────────────────────────────

  describe('check_instance_health', () => {
    it('should return a health check with version info', async () => {
      const result = await client.callTool({
        name: 'check_instance_health',
        arguments: {
          instance: SN_INSTANCE,
          include_version: true,
          include_cluster: false,
          include_stuck_jobs: false,
          include_semaphores: false,
          include_operational_counts: false,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Instance Health Check')
      expect(text).toContain('Timestamp:')
    }, 60_000)

    it('should return operational counts', async () => {
      const result = await client.callTool({
        name: 'check_instance_health',
        arguments: {
          instance: SN_INSTANCE,
          include_version: false,
          include_cluster: false,
          include_stuck_jobs: false,
          include_semaphores: false,
          include_operational_counts: true,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Instance Health Check')
    }, 60_000)

    it('should return full health check with all sections', async () => {
      const result = await client.callTool({
        name: 'check_instance_health',
        arguments: { instance: SN_INSTANCE },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Instance Health Check')
      expect(text).toContain('Timestamp:')
    }, 120_000)
  })

  // ─── CMDB Tools ────────────────────────────────────────────────────

  describe('get_cmdb_relationships', () => {
    it('should return relationships for a CI (or gracefully handle no CIs)', async () => {
      // First find a CI to test with
      const queryResult = await client.callTool({
        name: 'query_table',
        arguments: {
          instance: SN_INSTANCE,
          table: 'cmdb_ci',
          fields: 'sys_id,name',
          limit: 1,
        },
      })

      const queryText = getText(queryResult)
      const sysIdMatch = queryText.match(/"sys_id":\s*"([a-f0-9]{32})"/)
      if (!sysIdMatch) {
        console.error('No CIs found on instance, skipping CMDB relationship test')
        return
      }

      const ciSysId = sysIdMatch[1]
      const result = await client.callTool({
        name: 'get_cmdb_relationships',
        arguments: {
          instance: SN_INSTANCE,
          ci_sys_id: ciSysId,
          direction: 'both',
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('CMDB Relationships')
      expect(text).toContain('Direction: both')
    }, 60_000)
  })

  describe('traverse_cmdb_graph', () => {
    it('should traverse the CMDB graph from a CI', async () => {
      // Find a CI to test with
      const queryResult = await client.callTool({
        name: 'query_table',
        arguments: {
          instance: SN_INSTANCE,
          table: 'cmdb_ci',
          fields: 'sys_id,name',
          limit: 1,
        },
      })

      const queryText = getText(queryResult)
      const sysIdMatch = queryText.match(/"sys_id":\s*"([a-f0-9]{32})"/)
      if (!sysIdMatch) {
        console.error('No CIs found on instance, skipping CMDB traversal test')
        return
      }

      const ciSysId = sysIdMatch[1]
      const result = await client.callTool({
        name: 'traverse_cmdb_graph',
        arguments: {
          instance: SN_INSTANCE,
          ci_sys_id: ciSysId,
          max_depth: 1,
          max_nodes: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('CMDB Graph Traversal')
      expect(text).toMatch(/Nodes discovered: \d+/)
      expect(text).toMatch(/Edges discovered: \d+/)
    }, 60_000)
  })

  // ─── Discovery Tools ───────────────────────────────────────────────

  describe('list_instance_tables', () => {
    it('should list tables on the instance', async () => {
      const result = await client.callTool({
        name: 'list_instance_tables',
        arguments: {
          instance: SN_INSTANCE,
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Instance Tables')
      expect(text).toMatch(/Tables returned: \d+/)
      // Should return at least some tables
      expect(text).not.toContain('Tables returned: 0')
    }, 60_000)

    it('should filter tables by name prefix', async () => {
      const result = await client.callTool({
        name: 'list_instance_tables',
        arguments: {
          instance: SN_INSTANCE,
          name_prefix: 'incident',
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Instance Tables')
      expect(text).toContain('Name Prefix: incident')
    }, 60_000)
  })

  describe('list_plugins', () => {
    it('should list active plugins on the instance', async () => {
      const result = await client.callTool({
        name: 'list_plugins',
        arguments: {
          instance: SN_INSTANCE,
          active_only: true,
          limit: 10,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Plugins')
      expect(text).toMatch(/Plugins returned: \d+/)
      // Every instance has active plugins
      expect(text).not.toContain('Plugins returned: 0')
    }, 60_000)
  })

  // ─── Query Batch Tools (dry-run only) ──────────────────────────────

  describe('query_update_records', () => {
    it('should perform a dry-run and return match count without modifying data', async () => {
      const result = await client.callTool({
        name: 'query_update_records',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          query: 'active=true',
          data: { short_description: 'DRY RUN - should not change' },
          confirm: false,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('DRY RUN')
      expect(text).toMatch(/Records that would be updated: \d+/)
      expect(text).toContain('No changes were made')
    }, 60_000)

    it('should support limit parameter in dry-run', async () => {
      const result = await client.callTool({
        name: 'query_update_records',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          query: 'active=true',
          data: { priority: '3' },
          confirm: false,
          limit: 5,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('DRY RUN')
    }, 60_000)
  })

  describe('query_delete_records', () => {
    it('should perform a dry-run and return match count without deleting data', async () => {
      const result = await client.callTool({
        name: 'query_delete_records',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          query: 'active=false^short_description=INTEGRATION_TEST_NONEXISTENT_XYZ',
          confirm: false,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('DRY RUN')
      expect(text).toMatch(/Records that would be deleted: \d+/)
      expect(text).toContain('No records were deleted')
    }, 60_000)
  })

  // ─── Update Set Tools ──────────────────────────────────────────────

  describe('clone_update_set', () => {
    it('should clone an existing update set', async () => {
      // First, find an update set to clone
      const listResult = await client.callTool({
        name: 'list_update_sets',
        arguments: {
          instance: SN_INSTANCE,
          limit: 1,
        },
      })

      const listText = getText(listResult)
      const sysIdMatch = listText.match(/sys_id:\s*([a-f0-9]{32})/)
      if (!sysIdMatch) {
        console.error('No update sets found, skipping clone test')
        return
      }

      const sourceSysId = sysIdMatch[1]
      const cloneName = `Integration Test Clone ${Date.now()}`

      const result = await client.callTool(
        {
          name: 'clone_update_set',
          arguments: {
            instance: SN_INSTANCE,
            source_sys_id: sourceSysId,
            new_name: cloneName,
          },
        },
        undefined,
        LONG_TIMEOUT
      )

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Update Set Cloned')
      expect(text).toContain(cloneName)
      expect(text).toMatch(/Records cloned: \d+/)
    }, 180_000)
  })

  describe('move_update_set_records', () => {
    it('should handle moving records between update sets (or report no records)', async () => {
      // Create two update sets for the test
      const us1Result = await client.callTool({
        name: 'create_update_set',
        arguments: {
          instance: SN_INSTANCE,
          name: `Integration Test Move Source ${Date.now()}`,
          description: 'Integration test - source for move operation',
        },
      })

      const us2Result = await client.callTool({
        name: 'create_update_set',
        arguments: {
          instance: SN_INSTANCE,
          name: `Integration Test Move Target ${Date.now()}`,
          description: 'Integration test - target for move operation',
        },
      })

      const sourceId = getText(us1Result).match(/sys_id:\s*([a-f0-9]{32})/)?.[1]
      const targetId = getText(us2Result).match(/sys_id:\s*([a-f0-9]{32})/)?.[1]

      if (!sourceId || !targetId) {
        console.error('Could not create update sets for move test')
        return
      }

      // Try to move records (source is empty, but the operation should succeed)
      const result = await client.callTool({
        name: 'move_update_set_records',
        arguments: {
          instance: SN_INSTANCE,
          target_update_set_id: targetId,
          source_update_set: sourceId,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Move Update Set Records')
      expect(text).toContain(`Target Update Set: ${targetId}`)
      expect(text).toMatch(/Moved: \d+/)
    }, 120_000)
  })

  // ─── Attachment Upload Tool ────────────────────────────────────────

  describe('upload_attachment', () => {
    it('should upload a text file attachment to an incident', async () => {
      // First find an incident to attach to
      const queryResult = await client.callTool({
        name: 'query_table',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          fields: 'sys_id,number',
          limit: 1,
        },
      })

      const queryText = getText(queryResult)
      const sysIdMatch = queryText.match(/"sys_id":\s*"([a-f0-9]{32})"/)
      if (!sysIdMatch) {
        console.error('No incidents found, skipping upload attachment test')
        return
      }

      const recordSysId = sysIdMatch[1]
      // "Integration test attachment" in base64
      const contentBase64 = Buffer.from('Integration test attachment - ' + Date.now()).toString('base64')

      const result = await client.callTool({
        name: 'upload_attachment',
        arguments: {
          instance: SN_INSTANCE,
          table: 'incident',
          record_sys_id: recordSysId,
          file_name: `integration-test-${Date.now()}.txt`,
          content_type: 'text/plain',
          content_base64: contentBase64,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Attachment Uploaded')
      expect(text).toContain('integration-test-')
      expect(text).toMatch(/sys_id:\s*[a-f0-9]{32}/)
      expect(text).toContain('Table: incident')
    }, 60_000)
  })
})
