import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createTestClientServer } from '../../helpers/mcp-test-helpers.js'
import { progressReporter } from '../../../src/common/progress.js'

/**
 * These assert through the real protocol stack rather than calling
 * progressReporter directly, because the thing that can break is the wiring:
 * whether a progressToken supplied by the client actually reaches the handler's
 * `extra`, and whether a notification sent from inside a handler is delivered
 * mid-call rather than after the result.
 */

/** Registers a tool that reports N progress messages via the shared reporter. */
function registerProgressingTool(server: McpServer, messages: string[]): void {
  server.registerTool(
    'progressing_tool',
    {
      title: 'Progressing Tool',
      description: 'Emits progress messages, mimicking a core onProgress callback.',
      inputSchema: { noop: z.string().optional() },
    },
    async (_args, extra) => {
      const onProgress = progressReporter(extra)
      for (const m of messages) onProgress?.(m)
      return { content: [{ type: 'text' as const, text: `done:${onProgress ? 'reporting' : 'silent'}` }] }
    }
  )
}

describe('progressReporter', () => {
  let notifications: any[]

  beforeEach(() => {
    notifications = []
  })

  it('delivers a notification per core progress message when a token is supplied', async () => {
    const { client } = await createTestClientServer((s) =>
      registerProgressingTool(s, ['step one', 'step two', 'step three'])
    )
    client.setNotificationHandler(
      z.object({
        method: z.literal('notifications/progress'),
        params: z.object({
          progressToken: z.union([z.string(), z.number()]),
          progress: z.number(),
          total: z.number().optional(),
          message: z.string().optional(),
        }),
      }) as any,
      (n: any) => { notifications.push(n) }
    )

    await client.callTool({ name: 'progressing_tool', arguments: {} }, undefined, {
      onprogress: () => { /* supplying this makes the SDK attach a progressToken */ },
    })

    expect(notifications).toHaveLength(3)
    expect(notifications.map((n) => n.params.message)).toEqual(['step one', 'step two', 'step three'])
  })

  it('increases progress monotonically', async () => {
    const { client } = await createTestClientServer((s) => registerProgressingTool(s, ['a', 'b', 'c']))
    const seen: number[] = []

    await client.callTool({ name: 'progressing_tool', arguments: {} }, undefined, {
      onprogress: (p: any) => { seen.push(p.progress) },
    })

    expect(seen).toEqual([...seen].sort((x, y) => x - y))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('omits total, because core reports messages with no notion of completion', async () => {
    // Inventing a percentage from a message count would be a lie that gets worse
    // the longer the operation runs.
    const { client } = await createTestClientServer((s) => registerProgressingTool(s, ['only']))
    const seen: any[] = []

    await client.callTool({ name: 'progressing_tool', arguments: {} }, undefined, {
      onprogress: (p: any) => { seen.push(p) },
    })

    expect(seen).toHaveLength(1)
    expect(seen[0].total).toBeUndefined()
  })

  it('reports nothing when the client did not ask for progress', async () => {
    const { client } = await createTestClientServer((s) => registerProgressingTool(s, ['a', 'b']))
    client.setNotificationHandler(
      z.object({
        method: z.literal('notifications/progress'),
        params: z.object({ progressToken: z.union([z.string(), z.number()]), progress: z.number() }),
      }) as any,
      (n: any) => { notifications.push(n) }
    )

    const result: any = await client.callTool({ name: 'progressing_tool', arguments: {} })

    // No token means no callback at all, so core is never asked to build the strings.
    expect(result.content[0].text).toBe('done:silent')
    expect(notifications).toHaveLength(0)
  })

  it('returns undefined rather than a no-op when no token is present', () => {
    expect(progressReporter(undefined)).toBeUndefined()
    expect(progressReporter({ _meta: {} } as any)).toBeUndefined()
    expect(progressReporter({ _meta: { progressToken: undefined } } as any)).toBeUndefined()
  })

  it('does not fail the operation when sending a notification rejects', async () => {
    // A dropped notification must never take down the work being reported on.
    const onProgress = progressReporter({
      _meta: { progressToken: 'tok' },
      sendNotification: jest.fn(() => Promise.reject(new Error('transport gone'))),
    } as any)

    expect(() => onProgress?.('still fine')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })
})
