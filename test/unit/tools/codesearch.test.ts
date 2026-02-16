import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  createMockCodeSearchResults,
  createMockCodeSearchGroups,
  createMockCodeSearchTables,
  createMockCodeSearchTableRecord,
} from '../../helpers/mock-factories.js'

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()

jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockSearch = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetSearchGroups = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetTablesForSearchGroup = jest.fn<(...args: any[]) => Promise<any>>()
const mockAddTableToSearchGroup = jest.fn<(...args: any[]) => Promise<any>>()
const mockFormatResultsAsText = jest.fn<(results: any) => string>()

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  CodeSearch: Object.assign(
    jest.fn().mockImplementation(() => ({
      search: mockSearch,
      getSearchGroups: mockGetSearchGroups,
      getTablesForSearchGroup: mockGetTablesForSearchGroup,
      addTableToSearchGroup: mockAddTableToSearchGroup,
    })),
    {
      formatResultsAsText: mockFormatResultsAsText,
    }
  ),
}))

// Dynamic import after mocks (required for ESM)
const {
  registerCodeSearchTool,
  registerListCodeSearchGroupsTool,
  registerListCodeSearchTablesTool,
  registerAddCodeSearchTableTool,
} = await import('../../../src/tools/codesearch.js')

// ============================================================
// code_search tool
// ============================================================

describe('code_search tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()

    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    mockFormatResultsAsText.mockReturnValue('No results found.')

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerCodeSearchTool(server)

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
      expect(names).toContain('code_search')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'code_search')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('term')
      expect(props).toHaveProperty('search_group')
      expect(props).toHaveProperty('table')
      expect(props).toHaveProperty('current_app')
      expect(props).toHaveProperty('search_all_scopes')
      expect(props).toHaveProperty('limit')
    })

    it('should require term', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'code_search')!
      expect(tool.inputSchema.required).toContain('term')
    })

    it('should not require optional parameters', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'code_search')!
      const required = tool.inputSchema.required ?? []
      expect(required).not.toContain('instance')
      expect(required).not.toContain('search_group')
      expect(required).not.toContain('table')
      expect(required).not.toContain('current_app')
      expect(required).not.toContain('search_all_scopes')
      expect(required).not.toContain('limit')
    })
  })

  describe('search execution', () => {
    it('should search with the provided term and return formatted results', async () => {
      const mockResults = createMockCodeSearchResults(2)
      mockSearch.mockResolvedValue(mockResults)
      mockFormatResultsAsText.mockReturnValue(
        'Found 2 matches:\n  Script Include > TestScript1 > Script\n'
      )

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: 'GlideRecord' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Code Search Results')
      expect(text).toContain('Search: "GlideRecord"')
      expect(text).toContain('Found 2 matches')
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ term: 'GlideRecord' })
      )
      expect(mockFormatResultsAsText).toHaveBeenCalledWith(mockResults)
    })

    it('should pass search_group when provided', async () => {
      mockSearch.mockResolvedValue([])

      await client.callTool({
        name: 'code_search',
        arguments: { term: 'test', search_group: 'Default Code Search Group' },
      })

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          term: 'test',
          search_group: 'Default Code Search Group',
        })
      )
    })

    it('should pass table when provided with search_group', async () => {
      mockSearch.mockResolvedValue([])

      await client.callTool({
        name: 'code_search',
        arguments: {
          term: 'test',
          search_group: 'Default Code Search Group',
          table: 'sys_script_include',
        },
      })

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          term: 'test',
          search_group: 'Default Code Search Group',
          table: 'sys_script_include',
        })
      )
    })

    it('should auto-set search_all_scopes to false when current_app is provided', async () => {
      mockSearch.mockResolvedValue([])

      await client.callTool({
        name: 'code_search',
        arguments: { term: 'test', current_app: 'x_myapp' },
      })

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          term: 'test',
          current_app: 'x_myapp',
          search_all_scopes: false,
        })
      )
    })

    it('should respect explicit search_all_scopes even when current_app is set', async () => {
      mockSearch.mockResolvedValue([])

      await client.callTool({
        name: 'code_search',
        arguments: { term: 'test', current_app: 'x_myapp', search_all_scopes: true },
      })

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          term: 'test',
          current_app: 'x_myapp',
          search_all_scopes: true,
        })
      )
    })

    it('should pass limit when provided', async () => {
      mockSearch.mockResolvedValue([])

      await client.callTool({
        name: 'code_search',
        arguments: { term: 'test', limit: 50 },
      })

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          term: 'test',
          limit: 50,
        })
      )
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockSearch.mockResolvedValue([])

      await client.callTool({
        name: 'code_search',
        arguments: { term: 'test', instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith(
        'dev224436',
        expect.any(Function)
      )
    })
  })

  describe('output formatting', () => {
    it('should include search parameters in the header', async () => {
      mockSearch.mockResolvedValue([])

      const result = await client.callTool({
        name: 'code_search',
        arguments: {
          term: 'GlideRecord',
          search_group: 'MyGroup',
          table: 'sys_script_include',
          limit: 25,
        },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Search: "GlideRecord"')
      expect(text).toContain('Group: MyGroup')
      expect(text).toContain('Table: sys_script_include')
      expect(text).toContain('Limit: 25')
    })

    it('should include current_app in header when provided', async () => {
      mockSearch.mockResolvedValue([])

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: 'test', current_app: 'x_myapp' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('App: x_myapp')
    })

    it('should show tip about list_code_search_groups when no search_group is specified', async () => {
      mockSearch.mockResolvedValue(createMockCodeSearchResults(1))
      mockFormatResultsAsText.mockReturnValue('Found 1 matches:\n')

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: 'GlideRecord' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('list_code_search_groups')
    })

    it('should not show search_group tip when search_group is specified', async () => {
      mockSearch.mockResolvedValue(createMockCodeSearchResults(1))
      mockFormatResultsAsText.mockReturnValue('Found 1 matches:\n')

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: 'test', search_group: 'Default Code Search Group' },
      })

      const text = (result.content as any[])[0].text
      expect(text).not.toContain('list_code_search_groups')
    })

    it('should show no-results guidance when empty results', async () => {
      mockSearch.mockResolvedValue([])
      mockFormatResultsAsText.mockReturnValue('No results found.')

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: 'nonexistent_xyz' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('No matching code found')
      expect(text).toContain('list_code_search_tables')
    })
  })

  describe('error handling', () => {
    it('should return isError when withConnectionRetry throws', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: 'test' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error searching code')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when CodeSearch.search throws', async () => {
      mockSearch.mockRejectedValue(new Error('Code search failed. Status: 403'))

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: 'test' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error searching code')
      expect(text).toContain('403')
    })

    it('should return isError when search term validation fails', async () => {
      mockSearch.mockRejectedValue(new Error('Search term is required'))

      const result = await client.callTool({
        name: 'code_search',
        arguments: { term: '   ' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error searching code')
    })
  })
})

// ============================================================
// list_code_search_groups tool
// ============================================================

describe('list_code_search_groups tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()

    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerListCodeSearchGroupsTool(server)

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
      expect(names).toContain('list_code_search_groups')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'list_code_search_groups')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('limit')
    })

    it('should not require any parameters', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'list_code_search_groups')!
      const required = tool.inputSchema.required ?? []
      expect(required).not.toContain('instance')
      expect(required).not.toContain('limit')
    })
  })

  describe('listing groups', () => {
    it('should list search groups with names and sys_ids', async () => {
      const mockGroups = createMockCodeSearchGroups(2)
      mockGetSearchGroups.mockResolvedValue(mockGroups)

      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: {},
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Code Search Groups')
      expect(text).toContain('Found: 2 group(s)')
      expect(text).toContain('Default Code Search Group')
      expect(text).toContain('group-sys-id-1')
      expect(text).toContain('Custom Group 1')
      expect(text).toContain('group-sys-id-2')
    })

    it('should show descriptions when available', async () => {
      const mockGroups = createMockCodeSearchGroups(1)
      mockGetSearchGroups.mockResolvedValue(mockGroups)

      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: {},
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('The default code search group')
    })

    it('should truncate long descriptions', async () => {
      const groups = [{
        sys_id: 'long-desc-group',
        name: 'Long Desc Group',
        description: 'A'.repeat(200),
      }]
      mockGetSearchGroups.mockResolvedValue(groups)

      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: {},
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('A'.repeat(120) + '...')
      expect(text).not.toContain('A'.repeat(121))
    })

    it('should show empty message when no groups found', async () => {
      mockGetSearchGroups.mockResolvedValue([])

      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: {},
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('No code search groups found')
      expect(text).toContain('Found: 0 group(s)')
    })

    it('should pass limit to getSearchGroups', async () => {
      mockGetSearchGroups.mockResolvedValue([])

      await client.callTool({
        name: 'list_code_search_groups',
        arguments: { limit: 25 },
      })

      expect(mockGetSearchGroups).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25 })
      )
    })

    it('should include tip about using group name and sys_id', async () => {
      mockGetSearchGroups.mockResolvedValue(createMockCodeSearchGroups(1))

      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: {},
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('code_search')
      expect(text).toContain('add_code_search_table')
    })

    it('should pass instance alias to withConnectionRetry', async () => {
      mockGetSearchGroups.mockResolvedValue([])

      await client.callTool({
        name: 'list_code_search_groups',
        arguments: { instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith(
        'dev224436',
        expect.any(Function)
      )
    })
  })

  describe('error handling', () => {
    it('should return isError when withConnectionRetry throws', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error listing code search groups')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when getSearchGroups throws', async () => {
      mockGetSearchGroups.mockRejectedValue(
        new Error('Failed to query code search groups. Status: 500')
      )

      const result = await client.callTool({
        name: 'list_code_search_groups',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error listing code search groups')
      expect(text).toContain('500')
    })
  })
})

// ============================================================
// list_code_search_tables tool
// ============================================================

describe('list_code_search_tables tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()

    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerListCodeSearchTablesTool(server)

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
      expect(names).toContain('list_code_search_tables')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'list_code_search_tables')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('search_group')
    })

    it('should require search_group', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'list_code_search_tables')!
      expect(tool.inputSchema.required).toContain('search_group')
    })

    it('should not require instance', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'list_code_search_tables')!
      const required = tool.inputSchema.required ?? []
      expect(required).not.toContain('instance')
    })
  })

  describe('listing tables', () => {
    it('should list tables with names and labels', async () => {
      const mockTables = createMockCodeSearchTables(3)
      mockGetTablesForSearchGroup.mockResolvedValue(mockTables)

      const result = await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'Default Code Search Group' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Tables in Search Group: Default Code Search Group')
      expect(text).toContain('Found: 3 table(s)')
      expect(text).toContain('sys_script_include (Script Include)')
      expect(text).toContain('sys_script (Business Rule)')
      expect(text).toContain('sys_ui_script (UI Script)')
    })

    it('should show empty message when no tables found', async () => {
      mockGetTablesForSearchGroup.mockResolvedValue([])

      const result = await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'Empty Group' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('No tables found')
      expect(text).toContain('add_code_search_table')
    })

    it('should include tip about add_code_search_table when tables exist', async () => {
      mockGetTablesForSearchGroup.mockResolvedValue(createMockCodeSearchTables(1))

      const result = await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'Default Code Search Group' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('add_code_search_table')
    })

    it('should pass the search group name to getTablesForSearchGroup', async () => {
      mockGetTablesForSearchGroup.mockResolvedValue([])

      await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'My Custom Group' },
      })

      expect(mockGetTablesForSearchGroup).toHaveBeenCalledWith('My Custom Group')
    })

    it('should handle tables without labels', async () => {
      mockGetTablesForSearchGroup.mockResolvedValue([
        { name: 'sys_metadata' },
      ])

      const result = await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'Default Code Search Group' },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('sys_metadata')
      expect(text).not.toContain('(undefined)')
    })

    it('should pass instance alias to withConnectionRetry', async () => {
      mockGetTablesForSearchGroup.mockResolvedValue([])

      await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'Test Group', instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith(
        'dev224436',
        expect.any(Function)
      )
    })
  })

  describe('error handling', () => {
    it('should return isError when withConnectionRetry throws', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'Default Code Search Group' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error listing code search tables')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when getTablesForSearchGroup throws', async () => {
      mockGetTablesForSearchGroup.mockRejectedValue(
        new Error("Failed to list tables for search group 'Bad Group'. Status: 404")
      )

      const result = await client.callTool({
        name: 'list_code_search_tables',
        arguments: { search_group: 'Bad Group' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error listing code search tables')
      expect(text).toContain('404')
    })
  })
})

// ============================================================
// add_code_search_table tool
// ============================================================

describe('add_code_search_table tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()

    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerAddCodeSearchTableTool(server)

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
      expect(names).toContain('add_code_search_table')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'add_code_search_table')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('table')
      expect(props).toHaveProperty('search_fields')
      expect(props).toHaveProperty('search_group')
    })

    it('should require table, search_fields, and search_group', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'add_code_search_table')!
      expect(tool.inputSchema.required).toContain('table')
      expect(tool.inputSchema.required).toContain('search_fields')
      expect(tool.inputSchema.required).toContain('search_group')
    })

    it('should not require instance', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'add_code_search_table')!
      const required = tool.inputSchema.required ?? []
      expect(required).not.toContain('instance')
    })
  })

  describe('adding a table', () => {
    it('should add a table and return confirmation', async () => {
      const mockRecord = createMockCodeSearchTableRecord({
        sys_id: 'new-record-abc',
        table: 'sys_ui_action',
        search_fields: 'script,condition',
        search_group: 'group-123',
      })
      mockAddTableToSearchGroup.mockResolvedValue(mockRecord)

      const result = await client.callTool({
        name: 'add_code_search_table',
        arguments: {
          table: 'sys_ui_action',
          search_fields: 'script,condition',
          search_group: 'group-123',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Code Search Table Added')
      expect(text).toContain('Table: sys_ui_action')
      expect(text).toContain('Search Fields: script,condition')
      expect(text).toContain('sys_id: new-record-abc')
      expect(text).toContain('Search Group: group-123')
    })

    it('should pass correct parameters to addTableToSearchGroup', async () => {
      mockAddTableToSearchGroup.mockResolvedValue(createMockCodeSearchTableRecord())

      await client.callTool({
        name: 'add_code_search_table',
        arguments: {
          table: 'sys_script_include',
          search_fields: 'script,name',
          search_group: 'group-sys-id-1',
        },
      })

      expect(mockAddTableToSearchGroup).toHaveBeenCalledWith({
        table: 'sys_script_include',
        search_fields: 'script,name',
        search_group: 'group-sys-id-1',
      })
    })

    it('should include confirmation message about searchability', async () => {
      mockAddTableToSearchGroup.mockResolvedValue(createMockCodeSearchTableRecord())

      const result = await client.callTool({
        name: 'add_code_search_table',
        arguments: {
          table: 'sys_script_include',
          search_fields: 'script,name',
          search_group: 'group-sys-id-1',
        },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('table has been added')
      expect(text).toContain('Code searches')
    })

    it('should pass instance alias to withConnectionRetry', async () => {
      mockAddTableToSearchGroup.mockResolvedValue(createMockCodeSearchTableRecord())

      await client.callTool({
        name: 'add_code_search_table',
        arguments: {
          table: 'sys_script_include',
          search_fields: 'script',
          search_group: 'group-1',
          instance: 'dev224436',
        },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith(
        'dev224436',
        expect.any(Function)
      )
    })
  })

  describe('error handling', () => {
    it('should return isError when withConnectionRetry throws', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'add_code_search_table',
        arguments: {
          table: 'sys_script_include',
          search_fields: 'script',
          search_group: 'group-1',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error adding code search table')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when addTableToSearchGroup throws', async () => {
      mockAddTableToSearchGroup.mockRejectedValue(
        new Error("Failed to add table 'bad_table' to search group 'group-1'. Status: 400")
      )

      const result = await client.callTool({
        name: 'add_code_search_table',
        arguments: {
          table: 'bad_table',
          search_fields: 'script',
          search_group: 'group-1',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error adding code search table')
      expect(text).toContain('400')
    })

    it('should return isError when table name validation fails', async () => {
      mockAddTableToSearchGroup.mockRejectedValue(
        new Error('Table name is required')
      )

      const result = await client.callTool({
        name: 'add_code_search_table',
        arguments: {
          table: '   ',
          search_fields: 'script',
          search_group: 'group-1',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error adding code search table')
    })
  })
})
