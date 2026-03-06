import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockExportRecord = jest.fn<(...args: any[]) => Promise<any>>()
const mockImportRecords = jest.fn<(...args: any[]) => Promise<any>>()
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  XMLRecordManager: jest.fn().mockImplementation(() => ({
    exportRecord: mockExportRecord,
    importRecords: mockImportRecords,
  })),
}))

// Dynamic import after mocks (required for ESM)
const { registerExportRecordXmlTool, registerImportRecordsXmlTool } =
  await import('../../../src/tools/xml-record.js')

// ============================================================
// export_record_xml
// ============================================================

describe('export_record_xml tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerExportRecordXmlTool(server)

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
      expect(tools.map((t) => t.name)).toContain('export_record_xml')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'export_record_xml')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('table')
      expect(props).toHaveProperty('sys_id')
    })

    it('should require table and sys_id but not instance', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'export_record_xml')!
      expect(tool.inputSchema.required).toContain('table')
      expect(tool.inputSchema.required).toContain('sys_id')
      expect(tool.inputSchema.required).not.toContain('instance')
    })
  })

  describe('execution', () => {
    it('should export a record and return XML content', async () => {
      const xml = '<?xml version="1.0" encoding="UTF-8"?><unload><sys_script_include action="INSERT_OR_UPDATE"><sys_id>abc123</sys_id></sys_script_include></unload>'
      mockExportRecord.mockResolvedValue({
        xml,
        table: 'sys_script_include',
        sysId: 'abc123',
        unloadDate: '2026-03-06 12:00:00',
      })

      const result = await client.callTool({
        name: 'export_record_xml',
        arguments: { table: 'sys_script_include', sys_id: 'abc123' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('sys_script_include')
      expect(text).toContain('abc123')
      expect(text).toContain('unload date: 2026-03-06 12:00:00')
      expect(text).toContain(xml)
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockExportRecord.mockResolvedValue({
        xml: '<xml/>',
        table: 'incident',
        sysId: 'def456',
      })

      await client.callTool({
        name: 'export_record_xml',
        arguments: { table: 'incident', sys_id: 'def456', instance: 'dev224436' },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('dev224436', expect.any(Function))
    })

    it('should pass correct options to exportRecord', async () => {
      mockExportRecord.mockResolvedValue({
        xml: '<xml/>',
        table: 'incident',
        sysId: 'def456',
      })

      await client.callTool({
        name: 'export_record_xml',
        arguments: { table: 'incident', sys_id: 'def456' },
      })

      expect(mockExportRecord).toHaveBeenCalledWith({ table: 'incident', sysId: 'def456' })
    })
  })

  describe('error handling', () => {
    it('should return isError when export fails', async () => {
      mockExportRecord.mockRejectedValue(new Error('Record not found'))

      const result = await client.callTool({
        name: 'export_record_xml',
        arguments: { table: 'incident', sys_id: 'bad' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error exporting record')
      expect(text).toContain('Record not found')
    })

    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(new Error('No credentials found'))

      const result = await client.callTool({
        name: 'export_record_xml',
        arguments: { table: 'incident', sys_id: 'abc' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('No credentials found')
    })
  })
})

// ============================================================
// import_records_xml
// ============================================================

describe('import_records_xml tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerImportRecordsXmlTool(server)

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
      expect(tools.map((t) => t.name)).toContain('import_records_xml')
    })

    it('should require xml_content and target_table but not instance', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'import_records_xml')!
      expect(tool.inputSchema.required).toContain('xml_content')
      expect(tool.inputSchema.required).toContain('target_table')
      expect(tool.inputSchema.required).not.toContain('instance')
    })
  })

  describe('execution', () => {
    it('should import records and return success', async () => {
      mockImportRecords.mockResolvedValue({
        success: true,
        targetTable: 'sys_script_include',
      })

      const result = await client.callTool({
        name: 'import_records_xml',
        arguments: {
          xml_content: '<unload><sys_script_include/></unload>',
          target_table: 'sys_script_include',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Successfully imported')
      expect(text).toContain('sys_script_include')
    })

    it('should pass correct options to importRecords', async () => {
      mockImportRecords.mockResolvedValue({ success: true, targetTable: 'incident' })

      await client.callTool({
        name: 'import_records_xml',
        arguments: {
          xml_content: '<xml/>',
          target_table: 'incident',
        },
      })

      expect(mockImportRecords).toHaveBeenCalledWith({
        xmlContent: '<xml/>',
        targetTable: 'incident',
      })
    })
  })

  describe('error handling', () => {
    it('should return isError when import throws', async () => {
      mockImportRecords.mockRejectedValue(new Error('CSRF token failure'))

      const result = await client.callTool({
        name: 'import_records_xml',
        arguments: {
          xml_content: '<xml/>',
          target_table: 'incident',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error importing records')
      expect(text).toContain('CSRF token failure')
    })

    it('should return isError when result.success is false', async () => {
      mockImportRecords.mockResolvedValue({
        success: false,
        targetTable: 'incident',
      })

      const result = await client.callTool({
        name: 'import_records_xml',
        arguments: {
          xml_content: '<xml/>',
          target_table: 'incident',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Import failed')
      expect(text).toContain('incident')
    })
  })
})
