import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

// ---- Mock external dependencies before importing the module under test ----

const mockWithConnectionRetry = jest.fn<(alias: any, op: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({
  withConnectionRetry: mockWithConnectionRetry,
}))

const mockExecuteTest = jest.fn<(...args: any[]) => Promise<any>>()
const mockExecuteTestSuiteAndWait = jest.fn<(...args: any[]) => Promise<any>>()
const mockExecuteTestSuiteByNameAndWait = jest.fn<(...args: any[]) => Promise<any>>()

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  ATFTestExecutor: jest.fn().mockImplementation(() => ({
    executeTest: mockExecuteTest,
    executeTestSuiteAndWait: mockExecuteTestSuiteAndWait,
    executeTestSuiteByNameAndWait: mockExecuteTestSuiteByNameAndWait,
  })),
}))

// Dynamic import after mocks (required for ESM)
const { registerRunAtfTestTool, registerRunAtfTestSuiteTool } = await import('../../../src/tools/atf.js')

// ---- run_atf_test ----

describe('run_atf_test tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerRunAtfTestTool(server)

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
      expect(names).toContain('run_atf_test')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'run_atf_test')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('test_sys_id')
    })

    it('should require test_sys_id but not instance', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'run_atf_test')!
      expect(tool.inputSchema.required).toContain('test_sys_id')
      expect(tool.inputSchema.required).not.toContain('instance')
    })
  })

  describe('test execution', () => {
    it('should execute a test and return formatted results', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockResolvedValue({
        test_name: 'Validate Incident Creation',
        status: 'success',
        run_time: '00:00:12',
        test: { value: 'test-abc-123' },
        sys_id: 'result-xyz-789',
        output: 'All steps passed',
      })

      const result = await client.callTool({
        name: 'run_atf_test',
        arguments: {
          instance: 'dev12345',
          test_sys_id: 'test-abc-123',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Validate Incident Creation')
      expect(text).toContain('success')
      expect(text).toContain('00:00:12')
      expect(text).toContain('test-abc-123')
      expect(text).toContain('result-xyz-789')
      expect(text).toContain('All steps passed')
    })

    it('should pass the instance alias to getServiceNowInstance', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockResolvedValue({
        test_name: 'Test',
        status: 'success',
        run_time: '00:00:01',
        test: { value: 'abc' },
        sys_id: 'xyz',
        output: '',
      })

      await client.callTool({
        name: 'run_atf_test',
        arguments: {
          instance: 'dev224436',
          test_sys_id: 'abc',
        },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith('dev224436', expect.any(Function))
    })

    it('should pass undefined when instance is not provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockResolvedValue({
        test_name: 'Test',
        status: 'success',
        run_time: '00:00:01',
        test: { value: 'abc' },
        sys_id: 'xyz',
        output: '',
      })

      await client.callTool({
        name: 'run_atf_test',
        arguments: {
          test_sys_id: 'abc',
        },
      })

      expect(mockWithConnectionRetry).toHaveBeenCalledWith(undefined, expect.any(Function))
    })

    it('should pass the test_sys_id to executeTest', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockResolvedValue({
        test_name: 'Test',
        status: 'success',
        run_time: '00:00:01',
        test: { value: 'my-test-id' },
        sys_id: 'xyz',
        output: '',
      })

      await client.callTool({
        name: 'run_atf_test',
        arguments: {
          test_sys_id: 'my-test-id',
        },
      })

      expect(mockExecuteTest).toHaveBeenCalledWith('my-test-id')
    })
  })

  describe('output formatting', () => {
    it('should indicate failure when test status is not success', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockResolvedValue({
        test_name: 'Failing Test',
        status: 'failure',
        run_time: '00:00:03',
        test: { value: 'fail-test' },
        sys_id: 'fail-result',
        output: 'Step 3 assertion failed',
      })

      const result = await client.callTool({
        name: 'run_atf_test',
        arguments: { test_sys_id: 'fail-test' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('failure')
      expect(text).toContain('FAILED')
    })

    it('should not show FAILED message when test passes', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockResolvedValue({
        test_name: 'Passing Test',
        status: 'success',
        run_time: '00:00:01',
        test: { value: 'pass-test' },
        sys_id: 'pass-result',
        output: '',
      })

      const result = await client.callTool({
        name: 'run_atf_test',
        arguments: { test_sys_id: 'pass-test' },
      })

      const text = (result.content as any[])[0].text
      expect(text).not.toContain('FAILED')
    })

    it('should handle null result from executeTest', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockResolvedValue(null)

      const result = await client.callTool({
        name: 'run_atf_test',
        arguments: { test_sys_id: 'bad-test' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('no result')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad-alias"')
      )

      const result = await client.callTool({
        name: 'run_atf_test',
        arguments: {
          instance: 'bad-alias',
          test_sys_id: 'abc',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error running ATF test')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when test execution fails', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTest.mockRejectedValue(new Error('HTTP 403 Forbidden'))

      const result = await client.callTool({
        name: 'run_atf_test',
        arguments: { test_sys_id: 'abc' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error running ATF test')
      expect(text).toContain('403')
    })
  })
})

// ---- run_atf_test_suite ----

describe('run_atf_test_suite tool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    jest.clearAllMocks()
    mockWithConnectionRetry.mockImplementation(async (_alias: any, operation: any) => {
      return operation({})
    })

    server = new McpServer({ name: "test-server", version: "1.0.0" })
    registerRunAtfTestSuiteTool(server)

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
      expect(names).toContain('run_atf_test_suite')
    })

    it('should have the expected input schema properties', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'run_atf_test_suite')!
      const props = tool.inputSchema.properties!
      expect(props).toHaveProperty('instance')
      expect(props).toHaveProperty('suite_name')
      expect(props).toHaveProperty('suite_sys_id')
      expect(props).toHaveProperty('browser_name')
      expect(props).toHaveProperty('os_name')
      expect(props).toHaveProperty('is_performance_run')
      expect(props).toHaveProperty('run_in_cloud')
    })

    it('should not require any parameters (all optional at schema level)', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'run_atf_test_suite')!
      // All params are optional in schema; validation is in the handler
      expect(tool.inputSchema.required ?? []).not.toContain('suite_name')
      expect(tool.inputSchema.required ?? []).not.toContain('suite_sys_id')
    })
  })

  describe('suite execution by sys_id', () => {
    it('should execute suite by sys_id and return formatted results', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTestSuiteAndWait.mockResolvedValue({
        sys_id: 'sr-123',
        number: 'SUITE0001',
        test_suite: { value: 'my-suite' },
        status: 'success',
        success: 'true',
        start_time: '2024-01-01 10:00:00',
        end_time: '2024-01-01 10:05:00',
        run_time: '00:05:00',
        success_count: '10',
        failure_count: '0',
        skip_count: '2',
        error_count: '0',
      })

      const result = await client.callTool({
        name: 'run_atf_test_suite',
        arguments: {
          instance: 'dev12345',
          suite_sys_id: 'suite-abc',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('my-suite')
      expect(text).toContain('Total Tests: 12')
      expect(text).toContain('Passed: 10')
      expect(text).toContain('Failed: 0')
      expect(text).toContain('Skipped: 2')
      expect(text).toContain('Errors: 0')
      expect(text).toContain('All tests passed!')
      expect(mockExecuteTestSuiteAndWait).toHaveBeenCalledWith('suite-abc', undefined)
    })

    it('should pass execution options when provided', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTestSuiteAndWait.mockResolvedValue({
        sys_id: 'sr-123',
        number: 'SUITE0001',
        test_suite: { value: 'my-suite' },
        status: 'success',
        success: 'true',
        start_time: '2024-01-01 10:00:00',
        end_time: '2024-01-01 10:05:00',
        run_time: '00:05:00',
        success_count: '5',
        failure_count: '0',
        skip_count: '0',
        error_count: '0',
      })

      await client.callTool({
        name: 'run_atf_test_suite',
        arguments: {
          suite_sys_id: 'suite-abc',
          browser_name: 'Chrome',
          os_name: 'Windows',
          run_in_cloud: true,
        },
      })

      expect(mockExecuteTestSuiteAndWait).toHaveBeenCalledWith(
        'suite-abc',
        expect.objectContaining({
          browser_name: 'Chrome',
          os_name: 'Windows',
          run_in_cloud: true,
        })
      )
    })
  })

  describe('suite execution by name', () => {
    it('should execute suite by name using executeTestSuiteByNameAndWait', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTestSuiteByNameAndWait.mockResolvedValue({
        sys_id: 'sr-456',
        number: 'SUITE0002',
        test_suite: { value: 'Incident Tests' },
        status: 'success',
        success: 'true',
        start_time: '2024-01-01 10:00:00',
        end_time: '2024-01-01 10:02:00',
        run_time: '00:02:00',
        success_count: '3',
        failure_count: '0',
        skip_count: '0',
        error_count: '0',
      })

      const result = await client.callTool({
        name: 'run_atf_test_suite',
        arguments: {
          suite_name: 'Incident Tests',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Incident Tests')
      expect(text).toContain('Total Tests: 3')
      expect(mockExecuteTestSuiteByNameAndWait).toHaveBeenCalledWith('Incident Tests', undefined)
      expect(mockExecuteTestSuiteAndWait).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('should return error when neither suite_name nor suite_sys_id provided', async () => {
      const result = await client.callTool({
        name: 'run_atf_test_suite',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('must provide either suite_name or suite_sys_id')
    })

    it('should return error when both suite_name and suite_sys_id provided', async () => {
      const result = await client.callTool({
        name: 'run_atf_test_suite',
        arguments: {
          suite_name: 'My Suite',
          suite_sys_id: 'abc-123',
        },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('not both')
    })
  })

  describe('output formatting', () => {
    it('should show failure summary when tests fail', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTestSuiteAndWait.mockResolvedValue({
        sys_id: 'sr-789',
        number: 'SUITE0003',
        test_suite: { value: 'failing-suite' },
        status: 'failure',
        success: 'false',
        start_time: '2024-01-01 10:00:00',
        end_time: '2024-01-01 10:03:00',
        run_time: '00:03:00',
        success_count: '8',
        failure_count: '2',
        skip_count: '1',
        error_count: '1',
      })

      const result = await client.callTool({
        name: 'run_atf_test_suite',
        arguments: { suite_sys_id: 'failing-suite' },
      })

      expect(result.isError).toBeFalsy()
      const text = (result.content as any[])[0].text
      expect(text).toContain('Total Tests: 12')
      expect(text).toContain('Failed: 2')
      expect(text).toContain('Errors: 1')
      expect(text).toContain('2 test(s) failed, 1 error(s)')
      expect(text).not.toContain('All tests passed')
    })
  })

  describe('error handling', () => {
    it('should return isError when credentials fail', async () => {
      mockWithConnectionRetry.mockRejectedValue(
        new Error('No credentials found for auth alias "bad"')
      )

      const result = await client.callTool({
        name: 'run_atf_test_suite',
        arguments: { suite_sys_id: 'abc' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error running ATF test suite')
      expect(text).toContain('No credentials found')
    })

    it('should return isError when suite execution fails', async () => {
      // withConnectionRetry uses default mock implementation
      mockExecuteTestSuiteAndWait.mockRejectedValue(
        new Error('Test suite execution did not complete successfully')
      )

      const result = await client.callTool({
        name: 'run_atf_test_suite',
        arguments: { suite_sys_id: 'bad-suite' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as any[])[0].text
      expect(text).toContain('Error running ATF test suite')
      expect(text).toContain('did not complete successfully')
    })
  })
})
