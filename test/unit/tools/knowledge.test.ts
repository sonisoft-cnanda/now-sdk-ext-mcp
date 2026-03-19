import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockListKnowledgeBases = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetKnowledgeBase = jest.fn<(...args: any[]) => Promise<any>>()
const mockListCategories = jest.fn<(...args: any[]) => Promise<any>>()
const mockCreateCategory = jest.fn<(...args: any[]) => Promise<any>>()
const mockListArticles = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetArticle = jest.fn<(...args: any[]) => Promise<any>>()
const mockCreateArticle = jest.fn<(...args: any[]) => Promise<any>>()
const mockUpdateArticle = jest.fn<(...args: any[]) => Promise<any>>()
const mockPublishArticle = jest.fn<(...args: any[]) => Promise<any>>()

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  KnowledgeManager: jest.fn().mockImplementation(() => ({
    listKnowledgeBases: mockListKnowledgeBases,
    getKnowledgeBase: mockGetKnowledgeBase,
    listCategories: mockListCategories,
    createCategory: mockCreateCategory,
    listArticles: mockListArticles,
    getArticle: mockGetArticle,
    createArticle: mockCreateArticle,
    updateArticle: mockUpdateArticle,
    publishArticle: mockPublishArticle,
  })),
}))

const {
  registerListKnowledgeBasesTool,
  registerGetKnowledgeBaseTool,
  registerListKbCategoriesTool,
  registerCreateKbCategoryTool,
  registerListKbArticlesTool,
  registerGetKbArticleTool,
  registerCreateKbArticleTool,
  registerUpdateKbArticleTool,
  registerPublishKbArticleTool,
} = await import('../../../src/tools/knowledge.js')

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
// list_knowledge_bases
// ============================================================

describe('list_knowledge_bases tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerListKnowledgeBasesTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('list_knowledge_bases')
  })

  it('should not require instance', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'list_knowledge_bases')!
    expect(tool.inputSchema.required || []).not.toContain('instance')
  })

  it('should return formatted knowledge bases', async () => {
    mockListKnowledgeBases.mockResolvedValue([
      { sys_id: 'kb1', title: 'IT Knowledge', active: 'true' },
      { sys_id: 'kb2', title: 'HR Knowledge', active: 'true' },
    ])

    const result = await client.callTool({ name: 'list_knowledge_bases', arguments: {} })
    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('2 knowledge base(s)')
    expect(text).toContain('IT Knowledge')
    expect(text).toContain('HR Knowledge')
  })

  it('should return message when no KBs found', async () => {
    mockListKnowledgeBases.mockResolvedValue([])
    const result = await client.callTool({ name: 'list_knowledge_bases', arguments: {} })
    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('No knowledge bases found')
  })

  it('should return isError on failure', async () => {
    mockListKnowledgeBases.mockRejectedValue(new Error('API error'))
    const result = await client.callTool({ name: 'list_knowledge_bases', arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content as any[])[0].text).toContain('API error')
  })
})

// ============================================================
// get_knowledge_base
// ============================================================

describe('get_knowledge_base tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerGetKnowledgeBaseTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('get_knowledge_base')
  })

  it('should require sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'get_knowledge_base')!
    expect(tool.inputSchema.required).toContain('sys_id')
  })

  it('should return KB details with counts', async () => {
    mockGetKnowledgeBase.mockResolvedValue({
      knowledgeBase: { sys_id: 'kb1', title: 'IT KB', active: 'true' },
      articleCount: 42,
      categoryCount: 5,
    })

    const result = await client.callTool({
      name: 'get_knowledge_base',
      arguments: { sys_id: 'kb1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('IT KB')
    expect(text).toContain('Articles: 42')
    expect(text).toContain('Categories: 5')
  })

  it('should return isError on failure', async () => {
    mockGetKnowledgeBase.mockRejectedValue(new Error('Not found'))
    const result = await client.callTool({
      name: 'get_knowledge_base',
      arguments: { sys_id: 'bad' },
    })
    expect(result.isError).toBe(true)
  })
})

// ============================================================
// list_kb_categories
// ============================================================

describe('list_kb_categories tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerListKbCategoriesTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('list_kb_categories')
  })

  it('should return formatted categories', async () => {
    mockListCategories.mockResolvedValue([
      { sys_id: 'cat1', label: 'Networking', active: 'true' },
    ])

    const result = await client.callTool({ name: 'list_kb_categories', arguments: {} })
    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('1 category')
    expect(text).toContain('Networking')
  })

  it('should pass filter options to core library', async () => {
    mockListCategories.mockResolvedValue([])

    await client.callTool({
      name: 'list_kb_categories',
      arguments: { knowledge_base_sys_id: 'kb1', active: true },
    })

    expect(mockListCategories).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseSysId: 'kb1', active: true })
    )
  })
})

// ============================================================
// create_kb_category
// ============================================================

describe('create_kb_category tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerCreateKbCategoryTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('create_kb_category')
  })

  it('should require label and knowledge_base_sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'create_kb_category')!
    expect(tool.inputSchema.required).toContain('label')
    expect(tool.inputSchema.required).toContain('knowledge_base_sys_id')
  })

  it('should create a category and return success', async () => {
    mockCreateCategory.mockResolvedValue({
      sys_id: 'newcat1',
      label: 'VPN Issues',
    })

    const result = await client.callTool({
      name: 'create_kb_category',
      arguments: { label: 'VPN Issues', knowledge_base_sys_id: 'kb1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('VPN Issues')
    expect(text).toContain('created successfully')
    expect(text).toContain('newcat1')
  })

  it('should return isError on failure', async () => {
    mockCreateCategory.mockRejectedValue(new Error('Duplicate label'))
    const result = await client.callTool({
      name: 'create_kb_category',
      arguments: { label: 'Dup', knowledge_base_sys_id: 'kb1' },
    })
    expect(result.isError).toBe(true)
  })
})

// ============================================================
// list_kb_articles
// ============================================================

describe('list_kb_articles tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerListKbArticlesTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('list_kb_articles')
  })

  it('should return formatted article summaries', async () => {
    mockListArticles.mockResolvedValue([
      { sys_id: 'art1', number: 'KB0010001', short_description: 'How to reset password', workflow_state: 'published' },
      { sys_id: 'art2', number: 'KB0010002', short_description: 'VPN setup guide', workflow_state: 'draft' },
    ])

    const result = await client.callTool({ name: 'list_kb_articles', arguments: {} })
    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('2 article(s)')
    expect(text).toContain('KB0010001')
    expect(text).toContain('How to reset password')
    expect(text).toContain('published')
  })

  it('should pass filter options to core library', async () => {
    mockListArticles.mockResolvedValue([])

    await client.callTool({
      name: 'list_kb_articles',
      arguments: { workflow_state: 'draft', text_search: 'VPN' },
    })

    expect(mockListArticles).toHaveBeenCalledWith(
      expect.objectContaining({ workflowState: 'draft', textSearch: 'VPN' })
    )
  })
})

// ============================================================
// get_kb_article
// ============================================================

describe('get_kb_article tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerGetKbArticleTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('get_kb_article')
  })

  it('should require sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'get_kb_article')!
    expect(tool.inputSchema.required).toContain('sys_id')
  })

  it('should return full article with body', async () => {
    mockGetArticle.mockResolvedValue({
      sys_id: 'art1',
      number: 'KB0010001',
      short_description: 'Password Reset',
      workflow_state: 'published',
      active: 'true',
      article_type: 'text',
      kb_knowledge_base: 'kb1',
      kb_category: 'cat1',
      text: '<p>Steps to reset your password...</p>',
    })

    const result = await client.callTool({
      name: 'get_kb_article',
      arguments: { sys_id: 'art1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('Password Reset')
    expect(text).toContain('KB0010001')
    expect(text).toContain('published')
    expect(text).toContain('Steps to reset your password')
  })
})

// ============================================================
// create_kb_article
// ============================================================

describe('create_kb_article tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerCreateKbArticleTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('create_kb_article')
  })

  it('should require short_description and knowledge_base_sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'create_kb_article')!
    expect(tool.inputSchema.required).toContain('short_description')
    expect(tool.inputSchema.required).toContain('knowledge_base_sys_id')
  })

  it('should create an article and return success', async () => {
    mockCreateArticle.mockResolvedValue({
      sys_id: 'newart1',
      number: 'KB0010003',
      short_description: 'New Article',
      workflow_state: 'draft',
    })

    const result = await client.callTool({
      name: 'create_kb_article',
      arguments: {
        short_description: 'New Article',
        knowledge_base_sys_id: 'kb1',
        text: '<p>Article content</p>',
      },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('New Article')
    expect(text).toContain('created successfully')
    expect(text).toContain('KB0010003')
    expect(text).toContain('draft')
  })

  it('should pass all options to core library', async () => {
    mockCreateArticle.mockResolvedValue({
      sys_id: 'x', number: 'KB001', short_description: 'Test', workflow_state: 'draft',
    })

    await client.callTool({
      name: 'create_kb_article',
      arguments: {
        short_description: 'Test',
        knowledge_base_sys_id: 'kb1',
        text: '<p>body</p>',
        category_sys_id: 'cat1',
        workflow_state: 'published',
      },
    })

    expect(mockCreateArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        shortDescription: 'Test',
        knowledgeBaseSysId: 'kb1',
        text: '<p>body</p>',
        categorySysId: 'cat1',
        workflowState: 'published',
      })
    )
  })
})

// ============================================================
// update_kb_article
// ============================================================

describe('update_kb_article tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerUpdateKbArticleTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('update_kb_article')
  })

  it('should require sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'update_kb_article')!
    expect(tool.inputSchema.required).toContain('sys_id')
  })

  it('should update an article and return success', async () => {
    mockUpdateArticle.mockResolvedValue({
      sys_id: 'art1',
      short_description: 'Updated Title',
      workflow_state: 'draft',
    })

    const result = await client.callTool({
      name: 'update_kb_article',
      arguments: { sys_id: 'art1', short_description: 'Updated Title' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('Updated Title')
    expect(text).toContain('updated successfully')
  })

  it('should return isError on failure', async () => {
    mockUpdateArticle.mockRejectedValue(new Error('Not found'))
    const result = await client.callTool({
      name: 'update_kb_article',
      arguments: { sys_id: 'bad' },
    })
    expect(result.isError).toBe(true)
  })
})

// ============================================================
// publish_kb_article
// ============================================================

describe('publish_kb_article tool', () => {
  let server: McpServer, client: Client

  beforeEach(async () => {
    ({ server, client } = await setupTool(registerPublishKbArticleTool))
  })
  afterEach(async () => { await client.close(); await server.close() })

  it('should be listed as a registered tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('publish_kb_article')
  })

  it('should require sys_id', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'publish_kb_article')!
    expect(tool.inputSchema.required).toContain('sys_id')
  })

  it('should publish an article and return success', async () => {
    mockPublishArticle.mockResolvedValue({
      sys_id: 'art1',
      number: 'KB0010001',
      short_description: 'Password Reset',
      workflow_state: 'published',
    })

    const result = await client.callTool({
      name: 'publish_kb_article',
      arguments: { sys_id: 'art1' },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any[])[0].text
    expect(text).toContain('Password Reset')
    expect(text).toContain('published successfully')
    expect(text).toContain('KB0010001')
  })

  it('should return isError on failure', async () => {
    mockPublishArticle.mockRejectedValue(new Error('Permission denied'))
    const result = await client.callTool({
      name: 'publish_kb_article',
      arguments: { sys_id: 'art1' },
    })
    expect(result.isError).toBe(true)
    expect((result.content as any[])[0].text).toContain('Permission denied')
  })
})
