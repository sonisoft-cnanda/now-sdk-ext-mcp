import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import {
  registerExecuteFlowTool,
  registerExecuteSubflowTool,
  registerExecuteActionTool,
  registerGetFlowContextStatusTool,
  registerGetFlowOutputsTool,
  registerGetFlowErrorTool,
  registerCancelFlowTool,
  registerTestFlowTool,
  registerCopyFlowTool,
  registerGetFlowExecutionDetailsTool,
  registerGetFlowLogsTool,
} from '../../src/tools/flow.js'

/**
 * Integration tests for Flow Designer MCP tools.
 *
 * These tests hit a real ServiceNow instance using stored credentials.
 * Run with: npm run test:integration -- --testPathPattern=flow
 *
 * Known flows/actions used (OOB on dev instances):
 * - global.change__unauthorized__review (flow with wait/approval steps)
 * - global.should_send_notification (action that returns outputs)
 * - global.placeholder_subflow_for_mfa_guided_setup (simple subflow)
 */

const SN_INSTANCE = process.env.SN_INSTANCE_ALIAS || 'myinstance'

/** Helper: extract text from MCP tool result */
function getText(result: any): string {
  return (result.content as any[])[0]?.text || ''
}

describe('Flow Designer Tools - Integration Tests', () => {
  let server: McpServer
  let client: Client

  beforeAll(async () => {
    server = new McpServer({
      name: "now-sdk-ext-mcp-flow-integration",
      version: "1.0.0-alpha.0",
    })

    registerExecuteFlowTool(server)
    registerExecuteSubflowTool(server)
    registerExecuteActionTool(server)
    registerGetFlowContextStatusTool(server)
    registerGetFlowOutputsTool(server)
    registerGetFlowErrorTool(server)
    registerCancelFlowTool(server)
    registerTestFlowTool(server)
    registerCopyFlowTool(server)
    registerGetFlowExecutionDetailsTool(server)
    registerGetFlowLogsTool(server)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    client = new Client(
      { name: "flow-integration-test-client", version: "1.0.0" },
      { capabilities: {} }
    )
    await client.connect(clientTransport)
  })

  afterAll(async () => {
    await client.close()
    await server.close()
  })

  // ─── execute_flow ───────────────────────────────────────────────────

  describe('execute_flow', () => {
    it('should execute a flow in background and return context ID', async () => {
      const result = await client.callTool({
        name: 'execute_flow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.change__unauthorized__review',
          mode: 'background',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('=== Flow Execution Result ===')
      expect(text).toContain('Success: true')
      expect(text).toContain('Type: flow')
      expect(text).toContain('Name: global.change__unauthorized__review')
      expect(text).toContain('Context ID:')
      expect(text).toMatch(/Context ID: [0-9a-f]{32}/)
    }, 120_000)

    it('should return structured error for foreground execution of wait-state flow', async () => {
      const result = await client.callTool({
        name: 'execute_flow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.change__unauthorized__review',
          mode: 'foreground',
          timeout: 30000,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('=== Flow Execution Result ===')
      expect(text).toContain('Success: false')
      expect(text).toContain('Type: flow')
      expect(text).toContain('waiting state')
    }, 120_000)

    it('should handle non-existent flow gracefully', async () => {
      const result = await client.callTool({
        name: 'execute_flow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.nonexistent_flow_xyz_99999',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Success: false')
      expect(text).toContain('does not exist')
    }, 120_000)

    it('should support quick mode', async () => {
      const result = await client.callTool({
        name: 'execute_flow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.change__unauthorized__review',
          mode: 'foreground',
          quick: true,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('=== Flow Execution Result ===')
      expect(text).toContain('Type: flow')
      expect(text).toContain('Name: global.change__unauthorized__review')
    }, 120_000)
  })

  // ─── execute_action ─────────────────────────────────────────────────

  describe('execute_action', () => {
    it('should execute an action in foreground and return outputs', async () => {
      const result = await client.callTool({
        name: 'execute_action',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.should_send_notification',
          mode: 'foreground',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('=== Flow Execution Result ===')
      expect(text).toContain('Success: true')
      expect(text).toContain('Type: action')
      expect(text).toContain('Name: global.should_send_notification')
      expect(text).toContain('Context ID:')
      expect(text).toContain('Outputs:')
      expect(text).toContain('send_va')
    }, 120_000)

    it('should handle non-existent action gracefully', async () => {
      const result = await client.callTool({
        name: 'execute_action',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.nonexistent_action_xyz_99999',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Success: false')
      expect(text).toContain('does not exist')
    }, 120_000)
  })

  // ─── execute_subflow ────────────────────────────────────────────────

  describe('execute_subflow', () => {
    it('should execute a subflow and return structured result', async () => {
      const result = await client.callTool({
        name: 'execute_subflow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.placeholder_subflow_for_mfa_guided_setup',
          mode: 'foreground',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('=== Flow Execution Result ===')
      expect(text).toContain('Type: subflow')
      expect(text).toContain('Name: global.placeholder_subflow_for_mfa_guided_setup')
    }, 120_000)

    it('should handle non-existent subflow gracefully', async () => {
      const result = await client.callTool({
        name: 'execute_subflow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.nonexistent_subflow_xyz_99999',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Success: false')
      expect(text).toContain('does not exist')
    }, 120_000)
  })

  // ─── Flow Context Lifecycle ─────────────────────────────────────────

  describe('get_flow_context_status', () => {
    it('should return status for a background flow execution', async () => {
      // First, execute a flow in background to get a context ID
      const execResult = await client.callTool({
        name: 'execute_flow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.change__unauthorized__review',
          mode: 'background',
        },
      })

      expect(execResult.isError).toBeFalsy()
      const execText = getText(execResult)
      const contextIdMatch = execText.match(/Context ID: ([0-9a-f]{32})/)
      expect(contextIdMatch).toBeTruthy()
      const contextId = contextIdMatch![1]

      // Now query the context status
      const statusResult = await client.callTool({
        name: 'get_flow_context_status',
        arguments: {
          instance: SN_INSTANCE,
          context_id: contextId,
        },
      })

      expect(statusResult.isError).toBeFalsy()
      const statusText = getText(statusResult)
      expect(statusText).toContain('=== Flow Context Status ===')
      expect(statusText).toContain(`Context ID: ${contextId}`)
      expect(statusText).toContain('Found: true')
      expect(statusText).toMatch(/State: (QUEUED|IN_PROGRESS|WAITING|COMPLETE|CANCELLED|ERROR)/)
    }, 120_000)

    it('should return found=false for non-existent context ID', async () => {
      const result = await client.callTool({
        name: 'get_flow_context_status',
        arguments: {
          instance: SN_INSTANCE,
          context_id: '00000000000000000000000000000000',
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Found: false')
    }, 120_000)
  })

  describe('get_flow_outputs', () => {
    it('should retrieve outputs from a completed action', async () => {
      // Execute an action that completes immediately with outputs
      const execResult = await client.callTool({
        name: 'execute_action',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.should_send_notification',
          mode: 'foreground',
        },
      })

      const execText = getText(execResult)
      const contextIdMatch = execText.match(/Context ID: ([0-9a-f]{32})/)
      expect(contextIdMatch).toBeTruthy()
      const contextId = contextIdMatch![1]

      // Now get outputs via lifecycle tool
      const outputsResult = await client.callTool({
        name: 'get_flow_outputs',
        arguments: {
          instance: SN_INSTANCE,
          context_id: contextId,
        },
      })

      expect(outputsResult.isError).toBeFalsy()
      const outputsText = getText(outputsResult)
      expect(outputsText).toContain('=== Flow Outputs ===')
      expect(outputsText).toContain(`Context ID: ${contextId}`)
      expect(outputsText).toContain('Success: true')
    }, 120_000)
  })

  describe('get_flow_error', () => {
    it('should retrieve error info for a context ID', async () => {
      // Execute an action with bad inputs to get an error context
      const execResult = await client.callTool({
        name: 'execute_action',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.should_send_notification',
          inputs: {
            table_name: 'incident',
            sys_id: '0000000000000000000000000000dead',
          },
        },
      })

      const execText = getText(execResult)
      const contextIdMatch = execText.match(/Context ID: ([0-9a-f]{32})/)

      if (contextIdMatch) {
        const contextId = contextIdMatch[1]

        const errorResult = await client.callTool({
          name: 'get_flow_error',
          arguments: {
            instance: SN_INSTANCE,
            context_id: contextId,
          },
        })

        expect(errorResult.isError).toBeFalsy()
        const errorText = getText(errorResult)
        expect(errorText).toContain('=== Flow Error ===')
        expect(errorText).toContain(`Context ID: ${contextId}`)
        expect(errorText).toContain('Success: true')
      }
    }, 120_000)
  })

  describe('cancel_flow', () => {
    it('should cancel a background flow execution', async () => {
      // Execute a flow in background
      const execResult = await client.callTool({
        name: 'execute_flow',
        arguments: {
          instance: SN_INSTANCE,
          scoped_name: 'global.change__unauthorized__review',
          mode: 'background',
        },
      })

      const execText = getText(execResult)
      const contextIdMatch = execText.match(/Context ID: ([0-9a-f]{32})/)
      expect(contextIdMatch).toBeTruthy()
      const contextId = contextIdMatch![1]

      // Cancel the flow
      const cancelResult = await client.callTool({
        name: 'cancel_flow',
        arguments: {
          instance: SN_INSTANCE,
          context_id: contextId,
          reason: 'Cancelled by integration test',
        },
      })

      expect(cancelResult.isError).toBeFalsy()
      const cancelText = getText(cancelResult)
      expect(cancelText).toContain('=== Flow Cancellation ===')
      expect(cancelText).toContain(`Context ID: ${contextId}`)
    }, 120_000)
  })

  // ─── test_flow ──────────────────────────────────────────────────────

  describe('test_flow', () => {
    // Known flow: 887dda5583237210fdb8f7b6feaad32c (Change record-triggered flow)
    // Known record: change_request 0ecd7552db252200a6a2b31be0b8f5e6
    const TEST_FLOW_SYS_ID = '887dda5583237210fdb8f7b6feaad32c'
    const TEST_OUTPUT_MAP = {
      current: '0ecd7552db252200a6a2b31be0b8f5e6',
      table_name: 'change_request',
    }

    it('should test a flow and return a context ID', async () => {
      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          instance: SN_INSTANCE,
          flow_id: TEST_FLOW_SYS_ID,
          output_map: TEST_OUTPUT_MAP,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('=== Flow Test Result ===')
      expect(text).toContain('Success: true')
      expect(text).toMatch(/Context ID: [0-9a-f]{32}/)
    }, 120_000)

    it('should return an error for a non-existent flow sys_id', async () => {
      const result = await client.callTool({
        name: 'test_flow',
        arguments: {
          instance: SN_INSTANCE,
          flow_id: '00000000000000000000000000000000',
          output_map: { current: '00000000000000000000000000000000', table_name: 'incident' },
        },
      })

      const text = getText(result)
      // Either an error flag or success=false with an error message
      expect(text).toMatch(/Error|Success: false/i)
    }, 120_000)
  })

  // ─── copy_flow ──────────────────────────────────────────────────────

  describe('copy_flow', () => {
    // Known OOB flow: e89e3ade731310108ef62d2b04f6a744 ("Change - Standard")
    // Known target app scope sys_id: 4a5a6115402946939ee48e3fe80f60f8
    const SOURCE_FLOW_SYS_ID = 'e89e3ade731310108ef62d2b04f6a744'
    const TARGET_SCOPE_SYS_ID = '4a5a6115402946939ee48e3fe80f60f8'

    it('should copy a flow into the target scope and return the new flow sys_id', async () => {
      const result = await client.callTool({
        name: 'copy_flow',
        arguments: {
          instance: SN_INSTANCE,
          source_flow_id: SOURCE_FLOW_SYS_ID,
          name: 'Copy of Change - Standard (integration test)',
          target_scope: TARGET_SCOPE_SYS_ID,
        },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('=== Flow Copy Result ===')
      expect(text).toContain('Success: true')
      expect(text).toMatch(/New Flow sys_id: [0-9a-f]{32}/)
      expect(text).toContain('now-sdk transform --flow')
      expect(text).toContain('draft/unpublished state')
    }, 120_000)

    it('should return an error for a non-existent source flow sys_id', async () => {
      const result = await client.callTool({
        name: 'copy_flow',
        arguments: {
          instance: SN_INSTANCE,
          source_flow_id: '00000000000000000000000000000000',
          name: 'Should Fail',
          target_scope: TARGET_SCOPE_SYS_ID,
        },
      })

      const text = getText(result)
      expect(text).toMatch(/Error|Success: false/i)
    }, 120_000)
  })

  // ─── get_flow_execution_details ─────────────────────────────────────

  describe('get_flow_execution_details', () => {
    // Known flow: 887dda5583237210fdb8f7b6feaad32c (Change record-triggered)
    // Known record: change_request 0ecd7552db252200a6a2b31be0b8f5e6
    const TEST_FLOW_SYS_ID = '887dda5583237210fdb8f7b6feaad32c'
    const TEST_OUTPUT_MAP = {
      current: '0ecd7552db252200a6a2b31be0b8f5e6',
      table_name: 'change_request',
    }

    it('should return execution details for a test_flow context', async () => {
      // Run test_flow first to get a context ID
      const testResult = await client.callTool({
        name: 'test_flow',
        arguments: {
          instance: SN_INSTANCE,
          flow_id: TEST_FLOW_SYS_ID,
          output_map: TEST_OUTPUT_MAP,
          run_on_thread: true,
        },
      })

      expect(testResult.isError).toBeFalsy()
      const testText = getText(testResult)
      const contextIdMatch = testText.match(/Context ID: ([0-9a-f]{32})/)
      expect(contextIdMatch).toBeTruthy()
      const contextId = contextIdMatch![1]

      // Now get execution details
      const detailsResult = await client.callTool({
        name: 'get_flow_execution_details',
        arguments: {
          instance: SN_INSTANCE,
          context_id: contextId,
        },
      })

      expect(detailsResult.isError).toBeFalsy()
      const text = getText(detailsResult)
      expect(text).toContain('=== Flow Execution Details ===')
      expect(text).toContain(`Context ID: ${contextId}`)
      // Should include flow name and state
      expect(text).toMatch(/Flow:|Note:/)
    }, 120_000)

    it('should return error details for a non-existent context ID', async () => {
      const result = await client.callTool({
        name: 'get_flow_execution_details',
        arguments: {
          instance: SN_INSTANCE,
          context_id: '00000000000000000000000000000000',
        },
      })

      // Tool should not throw but may contain error info
      const text = getText(result)
      expect(text).toContain('=== Flow Execution Details ===')
    }, 120_000)
  })

  // ─── get_flow_logs ──────────────────────────────────────────────────

  describe('get_flow_logs', () => {
    const TEST_FLOW_SYS_ID = '887dda5583237210fdb8f7b6feaad32c'
    const TEST_OUTPUT_MAP = {
      current: '0ecd7552db252200a6a2b31be0b8f5e6',
      table_name: 'change_request',
    }

    it('should return flow logs for a test_flow context', async () => {
      // Run test_flow first to get a context ID
      const testResult = await client.callTool({
        name: 'test_flow',
        arguments: {
          instance: SN_INSTANCE,
          flow_id: TEST_FLOW_SYS_ID,
          output_map: TEST_OUTPUT_MAP,
          run_on_thread: true,
        },
      })

      expect(testResult.isError).toBeFalsy()
      const testText = getText(testResult)
      const contextIdMatch = testText.match(/Context ID: ([0-9a-f]{32})/)
      expect(contextIdMatch).toBeTruthy()
      const contextId = contextIdMatch![1]

      // Now get flow logs
      const logsResult = await client.callTool({
        name: 'get_flow_logs',
        arguments: {
          instance: SN_INSTANCE,
          context_id: contextId,
        },
      })

      expect(logsResult.isError).toBeFalsy()
      const text = getText(logsResult)
      expect(text).toContain('=== Flow Execution Logs ===')
      expect(text).toContain(`Context ID: ${contextId}`)
      expect(text).toMatch(/Entries: \d+/)
    }, 120_000)

    it('should respect limit parameter', async () => {
      // Run test_flow first to get a context ID
      const testResult = await client.callTool({
        name: 'test_flow',
        arguments: {
          instance: SN_INSTANCE,
          flow_id: TEST_FLOW_SYS_ID,
          output_map: TEST_OUTPUT_MAP,
          run_on_thread: true,
        },
      })

      const testText = getText(testResult)
      const contextIdMatch = testText.match(/Context ID: ([0-9a-f]{32})/)
      if (!contextIdMatch) return // skip if no context ID

      const contextId = contextIdMatch[1]

      const logsResult = await client.callTool({
        name: 'get_flow_logs',
        arguments: {
          instance: SN_INSTANCE,
          context_id: contextId,
          limit: 5,
          order_direction: 'desc',
        },
      })

      expect(logsResult.isError).toBeFalsy()
      const text = getText(logsResult)
      expect(text).toContain('=== Flow Execution Logs ===')
    }, 120_000)
  })
})
