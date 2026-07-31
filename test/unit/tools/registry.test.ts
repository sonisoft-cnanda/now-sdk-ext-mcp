import { describe, it, expect, jest } from '@jest/globals'
import { TOOL_REGISTRY, allToolNames } from '../../../src/tools/registry.js'

/**
 * Proves each registry entry registers the tool it is keyed by.
 *
 * The coverage tests elsewhere show that the registry, the annotations table and
 * the names parsed out of source describe the same SET. None of them would catch
 * a mis-paired entry — count_records mapped to registerAggregateQueryTool would
 * keep every set identical while making MCP_TOOL_PACKAGE select the wrong tool.
 */
describe('TOOL_REGISTRY pairing', () => {
  it('registers exactly the tool each key names', () => {
    const mismatched: string[] = []

    for (const [key, register] of Object.entries(TOOL_REGISTRY)) {
      const registered: string[] = []
      const fake = { registerTool: (name: string) => { registered.push(name) } }

      register(fake as never)

      if (registered.length !== 1 || registered[0] !== key) {
        mismatched.push(`${key} -> [${registered.join(', ')}]`)
      }
    }

    expect(mismatched).toEqual([])
  })

  it('holds every registrar as a callable', () => {
    // index.ts does TOOL_REGISTRY[name](server) with no guard.
    for (const name of allToolNames()) {
      expect(typeof TOOL_REGISTRY[name]).toBe('function')
    }
  })
})
