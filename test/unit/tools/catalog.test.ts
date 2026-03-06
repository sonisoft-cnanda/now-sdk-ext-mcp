import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockListCatalogItems = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetCatalogItem = jest.fn<(...args: any[]) => Promise<any>>()
const mockListCatalogCategories = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetCatalogCategory = jest.fn<(...args: any[]) => Promise<any>>()
const mockListCatalogItemVariables = jest.fn<(...args: any[]) => Promise<any>>()
const mockSubmitCatalogRequest = jest.fn<(...args: any[]) => Promise<any>>()

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  CatalogManager: jest.fn().mockImplementation(() => ({
    listCatalogItems: mockListCatalogItems,
    getCatalogItem: mockGetCatalogItem,
    listCatalogCategories: mockListCatalogCategories,
    getCatalogCategory: mockGetCatalogCategory,
    listCatalogItemVariables: mockListCatalogItemVariables,
    submitCatalogRequest: mockSubmitCatalogRequest,
  })),
}))

const {
  registerListCatalogItemsTool,
  registerGetCatalogItemTool,
  registerListCatalogCategoriesTool,
  registerGetCatalogCategoryTool,
  registerListCatalogItemVariablesTool,
  registerSubmitCatalogRequestTool,
} = await import('../../../src/tools/catalog.js')

// Helper to set up server + client for a specific tool
async function setupTool(registerFn: (server: McpServer) => void) {
  const server = new McpServer({ name: "test-server", version: "1.0.0" })
  registerFn(server)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  await client.connect(clientTransport)
  return { server, client }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
    return operation({})
  })
})

// ============================================================
// list_catalog_items
// ============================================================

describe('list_catalog_items tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerListCatalogItemsTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('list_catalog_items')
  })

  it('should not require instance', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'list_catalog_items')!
    expect(tool.inputSchema.required || []).not.toContain('instance')
  })

  it('should return formatted catalog items', async () => {
    mockListCatalogItems.mockResolvedValue([
      { sys_id: 'item1', name: 'Laptop Request', short_description: 'Request a new laptop', active: 'true' },
      { sys_id: 'item2', name: 'VPN Access', short_description: 'Request VPN access', active: 'true' },
    ])

    const result = await client.callTool({ name: 'list_catalog_items', arguments: {} })
    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('2 catalog item(s)')
    expect(text).toContain('Laptop Request')
    expect(text).toContain('VPN Access')
  })

  it('should return message when no items found', async () => {
    mockListCatalogItems.mockResolvedValue([])
    const result = await client.callTool({ name: 'list_catalog_items', arguments: {} })
    expect(result.isError).toBeFalsy()
    expect((result.content as any[])[0].text).toContain('No catalog items found')
  })

  it('should pass filter options to core library', async () => {
    mockListCatalogItems.mockResolvedValue([])

    await client.callTool({
      name: 'list_catalog_items',
      arguments: { text_search: 'laptop', active: true },
    })

    expect(mockListCatalogItems).toHaveBeenCalledWith(
      expect.objectContaining({ textSearch: 'laptop', active: true })
    )
  })

  it('should return isError on failure', async () => {
    mockListCatalogItems.mockRejectedValue(new Error('API error'))
    const result = await client.callTool({ name: 'list_catalog_items', arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content as any[])[0].text).toContain('API error')
  })
})

// ============================================================
// get_catalog_item
// ============================================================

describe('get_catalog_item tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerGetCatalogItemTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('get_catalog_item')
  })

  it('should require sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'get_catalog_item')!
    expect(tool.inputSchema.required).toContain('sys_id')
  })

  it('should return item details with variables', async () => {
    mockGetCatalogItem.mockResolvedValue({
      item: {
        sys_id: 'item1',
        name: 'Laptop Request',
        short_description: 'Request a new laptop',
        category: 'cat1',
        active: 'true',
        price: '$1200',
      },
      variables: [
        {
          sys_id: 'var1',
          name: 'laptop_model',
          question_text: 'Laptop Model',
          type: '6',
          friendly_type: 'Single Line Text',
          mandatory: 'true',
          default_value: '',
        },
      ],
    })

    const result = await client.callTool({
      name: 'get_catalog_item',
      arguments: { sys_id: 'item1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('Laptop Request')
    expect(text).toContain('$1200')
    expect(text).toContain('Variables (1)')
    expect(text).toContain('laptop_model')
    expect(text).toContain('Single Line Text')
    expect(text).toContain('mandatory: true')
  })

  it('should pass include_variables to core library', async () => {
    mockGetCatalogItem.mockResolvedValue({
      item: { sys_id: 'item1', name: 'Test', active: 'true' },
      variables: [],
    })

    await client.callTool({
      name: 'get_catalog_item',
      arguments: { sys_id: 'item1', include_variables: false },
    })

    expect(mockGetCatalogItem).toHaveBeenCalledWith('item1', false)
  })

  it('should return isError on failure', async () => {
    mockGetCatalogItem.mockRejectedValue(new Error('Not found'))
    const result = await client.callTool({
      name: 'get_catalog_item',
      arguments: { sys_id: 'bad' },
    })
    expect(result.isError).toBe(true)
  })
})

// ============================================================
// list_catalog_categories
// ============================================================

describe('list_catalog_categories tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerListCatalogCategoriesTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('list_catalog_categories')
  })

  it('should return formatted categories', async () => {
    mockListCatalogCategories.mockResolvedValue([
      { sys_id: 'cat1', title: 'Hardware', description: 'Hardware items', active: 'true' },
    ])

    const result = await client.callTool({ name: 'list_catalog_categories', arguments: {} })
    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('1 catalog category')
    expect(text).toContain('Hardware')
  })

  it('should return isError on failure', async () => {
    mockListCatalogCategories.mockRejectedValue(new Error('Forbidden'))
    const result = await client.callTool({ name: 'list_catalog_categories', arguments: {} })
    expect(result.isError).toBe(true)
  })
})

// ============================================================
// get_catalog_category
// ============================================================

describe('get_catalog_category tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerGetCatalogCategoryTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('get_catalog_category')
  })

  it('should require sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'get_catalog_category')!
    expect(tool.inputSchema.required).toContain('sys_id')
  })

  it('should return category details with item count', async () => {
    mockGetCatalogCategory.mockResolvedValue({
      category: {
        sys_id: 'cat1',
        title: 'Hardware',
        description: 'Hardware requests',
        active: 'true',
        parent: '',
      },
      itemCount: 15,
    })

    const result = await client.callTool({
      name: 'get_catalog_category',
      arguments: { sys_id: 'cat1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('Hardware')
    expect(text).toContain('Items in Category: 15')
  })
})

// ============================================================
// list_catalog_item_variables
// ============================================================

describe('list_catalog_item_variables tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerListCatalogItemVariablesTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('list_catalog_item_variables')
  })

  it('should require catalog_item_sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'list_catalog_item_variables')!
    expect(tool.inputSchema.required).toContain('catalog_item_sys_id')
  })

  it('should return formatted variables', async () => {
    mockListCatalogItemVariables.mockResolvedValue([
      {
        sys_id: 'var1',
        name: 'requested_for',
        question_text: 'Requested For',
        type: '8',
        friendly_type: 'Reference',
        mandatory: 'true',
        default_value: '',
        help_text: 'Select the user',
        reference: 'sys_user',
      },
      {
        sys_id: 'var2',
        name: 'justification',
        question_text: 'Business Justification',
        type: '2',
        friendly_type: 'Multi Line Text',
        mandatory: 'false',
        default_value: '',
        help_text: '',
        reference: '',
      },
    ])

    const result = await client.callTool({
      name: 'list_catalog_item_variables',
      arguments: { catalog_item_sys_id: 'item1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('2 variable(s)')
    expect(text).toContain('requested_for')
    expect(text).toContain('Reference')
    expect(text).toContain('Mandatory: true')
    expect(text).toContain('sys_user')
    expect(text).toContain('justification')
    expect(text).toContain('Multi Line Text')
  })

  it('should return message when no variables found', async () => {
    mockListCatalogItemVariables.mockResolvedValue([])
    const result = await client.callTool({
      name: 'list_catalog_item_variables',
      arguments: { catalog_item_sys_id: 'item1' },
    })
    expect(result.isError).toBeFalsy()
    expect((result.content as any[])[0].text).toContain('No variables found')
  })

  it('should pass include_variable_sets to core library', async () => {
    mockListCatalogItemVariables.mockResolvedValue([])

    await client.callTool({
      name: 'list_catalog_item_variables',
      arguments: { catalog_item_sys_id: 'item1', include_variable_sets: false },
    })

    expect(mockListCatalogItemVariables).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogItemSysId: 'item1',
        includeVariableSets: false,
      })
    )
  })
})

// ============================================================
// submit_catalog_request
// ============================================================

describe('submit_catalog_request tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerSubmitCatalogRequestTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('submit_catalog_request')
  })

  it('should require catalog_item_sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'submit_catalog_request')!
    expect(tool.inputSchema.required).toContain('catalog_item_sys_id')
  })

  it('should submit a request and return REQ and RITM numbers', async () => {
    mockSubmitCatalogRequest.mockResolvedValue({
      requestNumber: 'REQ0010001',
      requestSysId: 'req1',
      requestItemNumber: 'RITM0010001',
      requestItemSysId: 'ritm1',
    })

    const result = await client.callTool({
      name: 'submit_catalog_request',
      arguments: {
        catalog_item_sys_id: 'item1',
        quantity: 2,
        variables: { laptop_model: 'MacBook Pro' },
      },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('submitted successfully')
    expect(text).toContain('REQ0010001')
    expect(text).toContain('RITM0010001')
  })

  it('should pass correct options to core library', async () => {
    mockSubmitCatalogRequest.mockResolvedValue({
      requestNumber: 'REQ001',
      requestSysId: 'req1',
    })

    await client.callTool({
      name: 'submit_catalog_request',
      arguments: {
        catalog_item_sys_id: 'item1',
        quantity: 3,
        variables: { key: 'value' },
      },
    })

    expect(mockSubmitCatalogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogItemSysId: 'item1',
        quantity: 3,
        variables: { key: 'value' },
      })
    )
  })

  it('should handle request without RITM', async () => {
    mockSubmitCatalogRequest.mockResolvedValue({
      requestNumber: 'REQ0010001',
      requestSysId: 'req1',
    })

    const result = await client.callTool({
      name: 'submit_catalog_request',
      arguments: { catalog_item_sys_id: 'item1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('REQ0010001')
    expect(text).not.toContain('RITM')
  })

  it('should return isError on failure', async () => {
    mockSubmitCatalogRequest.mockRejectedValue(new Error('Insufficient permissions'))
    const result = await client.callTool({
      name: 'submit_catalog_request',
      arguments: { catalog_item_sys_id: 'item1' },
    })
    expect(result.isError).toBe(true)
    expect((result.content as any[])[0].text).toContain('Insufficient permissions')
  })

  it('should pass instance alias to withConnectionRetry', async () => {
    mockSubmitCatalogRequest.mockResolvedValue({
      requestNumber: 'REQ001',
      requestSysId: 'req1',
    })

    await client.callTool({
      name: 'submit_catalog_request',
      arguments: { catalog_item_sys_id: 'item1', instance: 'prod' },
    })

    expect(mockWithConnectionRetry).toHaveBeenCalledWith('prod', expect.any(Function))
  })
})
