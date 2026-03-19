import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockTestFlow = jest.fn<(...args: any[]) => Promise<any>>()
const mockCopyFlow = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetFlowContextDetails = jest.fn<(...args: any[]) => Promise<any>>()
const mockGetFlowLogs = jest.fn<(...args: any[]) => Promise<any>>()
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  FlowManager: jest.fn().mockImplementation(() => ({
    testFlow: mockTestFlow,
    copyFlow: mockCopyFlow,
    getFlowContextDetails: mockGetFlowContextDetails,
    getFlowLogs: mockGetFlowLogs,
  })),
}))

// Dynamic import after mocks (required for ESM)
const {
  registerTestFlowTool,
  registerCopyFlowTool,
  registerGetFlowExecutionDetailsTool,
  registerGetFlowLogsTool,
} = await import('../../../src/tools/flow.js')

// ============================================================
// test_flow
// ============================================================

describe('test_flow tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerTestFlowTool(server)

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
      expect(tools.map((t) => t.name)).toContain('test_flow')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'test_flow')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('flow_id')
      expect(props).toHaveProperty('output_map')
      expect(props).toHaveProperty('scope')
      expect(props).toHaveProperty('run_on_thread')
    })

    it('should require flow_id and output_map but not instance, scope, or run_on_thread', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'test_flow')!
      expect(tool.inputSchema.required).toContain('flow_id')
      expect(tool.inputSchema.required).toContain('output_map')
      expect(tool.inputSchema.required).not.toContain('instance')
      expect(tool.inputSchema.required).not.toContain('scope')
      expect(tool.inputSchema.required).not.toContain('run_on_thread')
    })
  })

  describe('execution', () => {
    it('should show synchronous completion message when run_on_thread is true (default)', async () => {
      mockTestFlow.mockResolvedValue({
        success: true,
        contextId: 'abc123def456789012345678abcdef01',
      })

      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          flow_id: '887dda5583237210fdb8f7b6feaad32c',
          output_map: { current: '0ecd7552db252200a6a2b31be0b8f5e6', table_name: 'change_request' },
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('=== Flow Test Result ===')
      expect(text).toContain('Success: true')
      expect(text).toContain('Context ID: abc123def456789012345678abcdef01')
      expect(text).toContain('ran synchronously')
      expect(text).toContain('get_flow_outputs')
      expect(text).not.toContain('get_flow_context_status')
    })

    it('should show polling message when run_on_thread is false', async () => {
      mockTestFlow.mockResolvedValue({
        success: true,
        contextId: 'abc123def456789012345678abcdef01',
      })

      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          flow_id: '887dda5583237210fdb8f7b6feaad32c',
          output_map: { current: '0ecd7552db252200a6a2b31be0b8f5e6', table_name: 'change_request' },
          run_on_thread: false,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('get_flow_context_status')
      expect(text).not.toContain('ran synchronously')
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockTestFlow.mockResolvedValue({ success: true, contextId: 'ctx123' })

      await client.callTool({
        name: 'test_flow',
        arguments: {
          instance: 'myinstance',
          flow_id: 'abc123',
          output_map: { current: 'rec123', table_name: 'incident' },
        },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('myinstance', expect.any(Function))
    })

    it('should pass correct options to FlowManager.testFlow', async () => {
      mockTestFlow.mockResolvedValue({ success: true, contextId: 'ctx456' })

      await client.callTool({
        name: 'test_flow',
        arguments: {
          flow_id: 'myflow123',
          output_map: { current: 'rec456', table_name: 'change_request' },
          scope: 'scopeid789',
          run_on_thread: false,
        },
      })

      expect(mockTestFlow).toHaveBeenCalledWith({
        flowId: 'myflow123',
        outputMap: { current: 'rec456', table_name: 'change_request' },
        scope: 'scopeid789',
        runOnThread: false,
      })
    })

    it('should default run_on_thread to true when omitted', async () => {
      mockTestFlow.mockResolvedValue({ success: true, contextId: 'ctx789' })

      await client.callTool({
        name: 'test_flow',
        arguments: {
          flow_id: 'myflow123',
          output_map: { current: 'rec123', table_name: 'incident' },
        },
      })

      expect(mockTestFlow).toHaveBeenCalledWith(
        expect.objectContaining({ runOnThread: true })
      )
    })

    it('should include error code in output when non-zero', async () => {
      mockTestFlow.mockResolvedValue({
        success: false,
        errorMessage: 'Flow definition not found',
        errorCode: 404,
      })

      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          flow_id: 'bad_flow',
          output_map: {},
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Success: false')
      expect(text).toContain('Error: Flow definition not found')
      expect(text).toContain('Error Code: 404')
    })

    it('should add blank line separator before error when contextId is also present', async () => {
      mockTestFlow.mockResolvedValue({
        success: false,
        contextId: 'ctx123',
        errorMessage: 'Flow failed mid-execution',
        errorCode: 0,
      })

      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          flow_id: 'myflow',
          output_map: {},
        },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Context ID: ctx123')
      expect(text).toContain('\nError: Flow failed mid-execution')
      // Ensure blank line separates contextId block from error
      expect(text).toMatch(/ran synchronously[\s\S]*\n\nError:/)
    })
  })

  describe('error handling', () => {
    it('should return isError when testFlow throws', async () => {
      mockTestFlow.mockRejectedValue(new Error('Network timeout'))

      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          flow_id: 'myflow',
          output_map: { current: 'rec123', table_name: 'incident' },
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error testing flow')
      expect(text).toContain('Network timeout')
    })

    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(new Error('No credentials found for alias: unknown'))

      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          instance: 'unknown',
          flow_id: 'myflow',
          output_map: {},
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('No credentials found')
    })
  })
})

// ============================================================
// copy_flow
// ============================================================

describe('copy_flow tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerCopyFlowTool(server)

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
      expect(tools.map((t) => t.name)).toContain('copy_flow')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'copy_flow')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('source_flow_id')
      expect(props).toHaveProperty('name')
      expect(props).toHaveProperty('target_scope')
    })

    it('should require source_flow_id, name, and target_scope but not instance', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'copy_flow')!
      expect(tool.inputSchema.required).toContain('source_flow_id')
      expect(tool.inputSchema.required).toContain('name')
      expect(tool.inputSchema.required).toContain('target_scope')
      expect(tool.inputSchema.required).not.toContain('instance')
    })
  })

  describe('execution', () => {
    it('should copy a flow and return the new sys_id with next-steps guidance', async () => {
      mockCopyFlow.mockResolvedValue({
        success: true,
        newFlowSysId: '887dda5583237210fdb8f7b6feaad32c',
      })

      const result = await client.callTool({
        name: 'copy_flow',
        arguments: {
          source_flow_id: 'e89e3ade731310108ef62d2b04f6a744',
          name: 'Copy of Change - Standard',
          target_scope: '4a5a6115402946939ee48e3fe80f60f8',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('=== Flow Copy Result ===')
      expect(text).toContain('Success: true')
      expect(text).toContain('New Flow sys_id: 887dda5583237210fdb8f7b6feaad32c')
      expect(text).toContain('draft/unpublished state')
      expect(text).toContain('now-sdk transform --flow 887dda5583237210fdb8f7b6feaad32c')
      expect(text).toContain('test_flow')
      expect(text).toContain('publish_flow')
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockCopyFlow.mockResolvedValue({ success: true, newFlowSysId: 'ae463bf4ff3d143cab0192352a65a4f5' })

      await client.callTool({
        name: 'copy_flow',
        arguments: {
          instance: 'myinstance',
          source_flow_id: 'e89e3ade731310108ef62d2b04f6a744',
          name: 'Copy of Change - Standard',
          target_scope: '4a5a6115402946939ee48e3fe80f60f8',
        },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('myinstance', expect.any(Function))
    })

    it('should pass correct options to FlowManager.copyFlow', async () => {
      mockCopyFlow.mockResolvedValue({ success: true, newFlowSysId: '887dda5583237210fdb8f7b6feaad32c' })

      await client.callTool({
        name: 'copy_flow',
        arguments: {
          source_flow_id: 'e89e3ade731310108ef62d2b04f6a744',
          name: 'My Custom Copy',
          target_scope: '4a5a6115402946939ee48e3fe80f60f8',
        },
      })

      expect(mockCopyFlow).toHaveBeenCalledWith({
        sourceFlowId: 'e89e3ade731310108ef62d2b04f6a744',
        name: 'My Custom Copy',
        targetScope: '4a5a6115402946939ee48e3fe80f60f8',
      })
    })

    it('should include error code when non-zero', async () => {
      mockCopyFlow.mockResolvedValue({
        success: false,
        errorMessage: 'Source flow not found',
        errorCode: 404,
      })

      const result = await client.callTool({
        name: 'copy_flow',
        arguments: {
          source_flow_id: '00000000000000000000000000000000',
          name: 'Bad Copy',
          target_scope: '4a5a6115402946939ee48e3fe80f60f8',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Success: false')
      expect(text).toContain('Error: Source flow not found')
      expect(text).toContain('Error Code: 404')
    })

    it('should show warning when success is true but no newFlowSysId is returned', async () => {
      mockCopyFlow.mockResolvedValue({ success: true })

      const result = await client.callTool({
        name: 'copy_flow',
        arguments: {
          source_flow_id: 'e89e3ade731310108ef62d2b04f6a744',
          name: 'Copy of Change - Standard',
          target_scope: '4a5a6115402946939ee48e3fe80f60f8',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Success: true')
      expect(text).toContain('may not have completed successfully')
      expect(text).not.toContain('now-sdk transform')
    })
  })

  describe('error handling', () => {
    it('should return isError when copyFlow throws', async () => {
      mockCopyFlow.mockRejectedValue(new Error('Network timeout'))

      const result = await client.callTool({
        name: 'copy_flow',
        arguments: {
          source_flow_id: 'e89e3ade731310108ef62d2b04f6a744',
          name: 'My Copy',
          target_scope: '4a5a6115402946939ee48e3fe80f60f8',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error copying flow')
      expect(text).toContain('Network timeout')
    })

    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(new Error('No credentials found for alias: unknown'))

      const result = await client.callTool({
        name: 'copy_flow',
        arguments: {
          instance: 'unknown',
          source_flow_id: 'e89e3ade731310108ef62d2b04f6a744',
          name: 'My Copy',
          target_scope: '4a5a6115402946939ee48e3fe80f60f8',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('No credentials found')
    })
  })
})

// ============================================================
// get_flow_execution_details
// ============================================================

describe('get_flow_execution_details tool', () => {
  let server: McpServer
  let client: Client

  const MOCK_CONTEXT_ID = 'a1b2c3d4e5f6789012345678abcdef01'

  const mockSuccessResult = {
    success: true,
    contextId: MOCK_CONTEXT_ID,
    flowContext: {
      flowId: 'flow123',
      name: 'Change - Unauthorized Review',
      state: 'COMPLETE',
      runTime: '1234',
      isTestRun: true,
      executedAs: 'admin',
      flowInitiatedBy: 'admin',
      reporting: 'TRACE',
      debugMode: false,
      executionSource: {
        callingSource: 'TEST_BUTTON',
        executionSourceTable: 'change_request',
        executionSourceRecord: 'rec123',
        executionSourceRecordDisplay: 'CHG0001234',
      },
      enableOpsViewExpansion: false,
      flowRetentionPolicyCandidate: false,
    },
    flowReport: {
      flowId: 'snap123',
      domainSeparationEnabled: false,
      executionDomain: 'global',
      actionOperationsReports: {
        'act001': {
          fStepCount: '3',
          actionName: 'act001',
          instanceReference: 'inst001',
          stepLabel: 'Create Incident',
          actionTypeName: 'Create Record',
          stepComment: '',
          operationsCore: { error: '', state: 'COMPLETE', startTime: '2024-01-01T00:00:00Z', order: '1', runTime: '120' },
          relatedLinks: {},
          operationsOutput: { data: { sys_id: { value: 'inc001', displayValue: 'INC0001234', inputUsed: false } } },
          operationsInput: { data: { table_name: { value: 'incident', displayValue: 'Incident', inputUsed: true } } },
          reportId: 'rep001',
        },
      },
      subflowOperationsReports: {},
      iterationOperationsReports: {},
      instanceReference: 'flinst001',
      operationsCore: { error: '', state: 'COMPLETE', startTime: '2024-01-01T00:00:00Z', order: '0', runTime: '1234', context: MOCK_CONTEXT_ID },
      relatedLinks: {},
      operationsOutput: { data: {} },
      operationsInput: { data: {} },
      reportId: 'flowrep001',
    },
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerGetFlowExecutionDetailsTool(server)

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
      expect(tools.map((t) => t.name)).toContain('get_flow_execution_details')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'get_flow_execution_details')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('context_id')
      expect(props).toHaveProperty('scope')
      expect(props).toHaveProperty('include_flow_definition')
    })

    it('should require context_id but not instance, scope, or include_flow_definition', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'get_flow_execution_details')!
      expect(tool.inputSchema.required).toContain('context_id')
      expect(tool.inputSchema.required).not.toContain('instance')
      expect(tool.inputSchema.required).not.toContain('scope')
      expect(tool.inputSchema.required).not.toContain('include_flow_definition')
    })
  })

  describe('execution', () => {
    it('should return formatted flow context details with action results', async () => {
      mockGetFlowContextDetails.mockResolvedValue(mockSuccessResult)

      const result = await client.callTool({
        name: 'get_flow_execution_details',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('=== Flow Execution Details ===')
      expect(text).toContain(`Context ID: ${MOCK_CONTEXT_ID}`)
      expect(text).toContain('Flow: Change - Unauthorized Review')
      expect(text).toContain('State: COMPLETE')
      expect(text).toContain('Runtime: 1234ms')
      expect(text).toContain('Test Run: true')
      expect(text).toContain('Executed As: admin')
      expect(text).toContain('Triggered By: TEST_BUTTON')
      expect(text).toContain('--- Action Results ---')
      expect(text).toContain('Create Incident')
      expect(text).toContain('COMPLETE')
    })

    it('should show action inputs and outputs', async () => {
      mockGetFlowContextDetails.mockResolvedValue(mockSuccessResult)

      const result = await client.callTool({
        name: 'get_flow_execution_details',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Inputs:')
      expect(text).toContain('Incident')
      expect(text).toContain('Outputs:')
      expect(text).toContain('INC0001234')
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockGetFlowContextDetails.mockResolvedValue({ success: true, contextId: MOCK_CONTEXT_ID })

      await client.callTool({
        name: 'get_flow_execution_details',
        arguments: { instance: 'myinstance', context_id: MOCK_CONTEXT_ID },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('myinstance', expect.any(Function))
    })

    it('should pass correct args to FlowManager.getFlowContextDetails', async () => {
      mockGetFlowContextDetails.mockResolvedValue({ success: true, contextId: MOCK_CONTEXT_ID })

      await client.callTool({
        name: 'get_flow_execution_details',
        arguments: {
          context_id: MOCK_CONTEXT_ID,
          scope: 'scopeid789',
          include_flow_definition: true,
        },
      })

      expect(mockGetFlowContextDetails).toHaveBeenCalledWith(MOCK_CONTEXT_ID, 'scopeid789', true)
    })

    it('should show report availability notice when flowReport is absent', async () => {
      mockGetFlowContextDetails.mockResolvedValue({
        success: true,
        contextId: MOCK_CONTEXT_ID,
        flowContext: mockSuccessResult.flowContext,
        flowReportAvailabilityDetails: {
          errorMessage: 'Execution report not available — operations logging is disabled.',
          errorLevel: 'notification-info',
          linkMessage: '',
          linkURL: '',
        },
      })

      const result = await client.callTool({
        name: 'get_flow_execution_details',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Note: Execution report not available')
    })
  })

  describe('error handling', () => {
    it('should return isError when getFlowContextDetails throws', async () => {
      mockGetFlowContextDetails.mockRejectedValue(new Error('API timeout'))

      const result = await client.callTool({
        name: 'get_flow_execution_details',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error getting flow execution details')
      expect(text).toContain('API timeout')
    })

    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(new Error('No credentials found for alias: unknown'))

      const result = await client.callTool({
        name: 'get_flow_execution_details',
        arguments: { instance: 'unknown', context_id: MOCK_CONTEXT_ID },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('No credentials found')
    })
  })
})

// ============================================================
// get_flow_logs
// ============================================================

describe('get_flow_logs tool', () => {
  let server: McpServer
  let client: Client

  const MOCK_CONTEXT_ID = 'b2c3d4e5f6789012345678abcdef0123'

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerGetFlowLogsTool(server)

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
      expect(tools.map((t) => t.name)).toContain('get_flow_logs')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'get_flow_logs')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('context_id')
      expect(props).toHaveProperty('limit')
      expect(props).toHaveProperty('order_direction')
    })

    it('should require context_id but not instance, limit, or order_direction', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'get_flow_logs')!
      expect(tool.inputSchema.required).toContain('context_id')
      expect(tool.inputSchema.required).not.toContain('instance')
      expect(tool.inputSchema.required).not.toContain('limit')
      expect(tool.inputSchema.required).not.toContain('order_direction')
    })
  })

  describe('execution', () => {
    it('should return formatted log entries with level and message', async () => {
      mockGetFlowLogs.mockResolvedValue({
        success: true,
        contextId: MOCK_CONTEXT_ID,
        entries: [
          {
            sysId: 'log001',
            level: '2',
            message: 'Record created: INC0001234',
            action: 'action.create_record',
            operation: 'create',
            order: '1',
            createdOn: '2024-01-01 00:00:01',
            createdBy: 'admin',
          },
          {
            sysId: 'log002',
            level: '-1',
            message: 'Failed to send notification: no recipients',
            action: 'action.send_email',
            operation: 'execute',
            order: '2',
            createdOn: '2024-01-01 00:00:02',
            createdBy: 'admin',
          },
        ],
      })

      const result = await client.callTool({
        name: 'get_flow_logs',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('=== Flow Execution Logs ===')
      expect(text).toContain(`Context ID: ${MOCK_CONTEXT_ID}`)
      expect(text).toContain('Entries: 2')
      expect(text).toContain('INFO ')
      expect(text).toContain('Record created: INC0001234')
      expect(text).toContain('ERROR')
      expect(text).toContain('Failed to send notification')
    })

    it('should show empty message when entries array is empty', async () => {
      mockGetFlowLogs.mockResolvedValue({
        success: true,
        contextId: MOCK_CONTEXT_ID,
        entries: [],
      })

      const result = await client.callTool({
        name: 'get_flow_logs',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('Entries: 0')
      expect(text).toContain('No log entries found')
    })

    it('should pass the instance alias to withConnectionRetry', async () => {
      mockGetFlowLogs.mockResolvedValue({ success: true, contextId: MOCK_CONTEXT_ID, entries: [] })

      await client.callTool({
        name: 'get_flow_logs',
        arguments: { instance: 'myinstance', context_id: MOCK_CONTEXT_ID },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('myinstance', expect.any(Function))
    })

    it('should pass correct options to FlowManager.getFlowLogs', async () => {
      mockGetFlowLogs.mockResolvedValue({ success: true, contextId: MOCK_CONTEXT_ID, entries: [] })

      await client.callTool({
        name: 'get_flow_logs',
        arguments: {
          context_id: MOCK_CONTEXT_ID,
          limit: 50,
          order_direction: 'desc',
        },
      })

      expect(mockGetFlowLogs).toHaveBeenCalledWith(MOCK_CONTEXT_ID, { limit: 50, orderDirection: 'desc' })
    })

    it('should include timestamp in each log entry', async () => {
      mockGetFlowLogs.mockResolvedValue({
        success: true,
        contextId: MOCK_CONTEXT_ID,
        entries: [
          {
            sysId: 'log001',
            level: '2',
            message: 'Step executed',
            action: 'action.step',
            operation: 'execute',
            order: '1',
            createdOn: '2024-06-01 12:34:56',
            createdBy: 'admin',
          },
        ],
      })

      const result = await client.callTool({
        name: 'get_flow_logs',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      const text = (result.content as any[])[0].text
      expect(text).toContain('2024-06-01 12:34:56')
    })
  })

  describe('error handling', () => {
    it('should return isError when getFlowLogs throws', async () => {
      mockGetFlowLogs.mockRejectedValue(new Error('Table access denied'))

      const result = await client.callTool({
        name: 'get_flow_logs',
        arguments: { context_id: MOCK_CONTEXT_ID },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error getting flow logs')
      expect(text).toContain('Table access denied')
    })

    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(new Error('No credentials found for alias: unknown'))

      const result = await client.callTool({
        name: 'get_flow_logs',
        arguments: { instance: 'unknown', context_id: MOCK_CONTEXT_ID },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('No credentials found')
    })
  })
})
