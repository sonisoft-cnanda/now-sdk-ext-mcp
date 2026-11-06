import { describe, it, expect } from '@jest/globals'
import { FlowManager } from '@sonisoft/now-sdk-ext-core'

/**
 * send_flow_message passes the message and payload to core, which puts them into a single-quoted literal in a
 * background script. This runs core's real script builder and then the script itself (with stubs for the platform
 * APIs) to pin that the values arrive as data, character for character, and never as code.
 */
const build = (context: string, message: string, payload: string): string => {
  const proto = FlowManager.prototype as any
  return proto._buildSendMessageScript.call({ _escapeForScript: proto._escapeForScript }, context, message, payload)
}

const run = (script: string) => {
  const sent: unknown[][] = []
  const executed: string[] = []
  const gs = { info: (line: string) => { if (!line.includes('__flowResult')) executed.push(line) } }
  const sn_fd = { FlowAPI: { sendMessage: (...args: unknown[]) => { sent.push(args) } } }
  new Function('gs', 'sn_fd', script)(gs, sn_fd)
  return { sent, executed }
}

const QUOTE = "'"
const BACKSLASH = '\\'

describe("core's flow message script", () => {
  it.each([
    [`a${QUOTE}); gs.info(${QUOTE}injected`, `x${QUOTE}); gs.info(${QUOTE}injected`],
    [`back${BACKSLASH}${BACKSLASH}slash ${BACKSLASH}${QUOTE} quote`, `${BACKSLASH}${QUOTE}); gs.info(${QUOTE}injected`],
    ['"double" and `tick` ${x}', `{"a":"b${QUOTE}c","d":[1,2]}`],
    ['trailing backslash' + BACKSLASH, BACKSLASH],
  ])('passes %j and %j through as data', (message, payload) => {
    const context = 'a'.repeat(32)
    const { sent, executed } = run(build(context, message, payload))
    expect(sent).toEqual([[context, message, payload]])
    expect(executed).toEqual([])
  })
})
