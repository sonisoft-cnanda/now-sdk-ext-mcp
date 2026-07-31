import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestClientServer } from '../../helpers/mcp-test-helpers.js'
import { TOOL_ANNOTATIONS, annotationsFor } from '../../../src/common/annotations.js'
import { allToolNames } from '../../../src/tools/registry.js'

/** Every tool name actually registered in src/tools/, read from source. */
function registeredToolNames(): string[] {
  const dir = join(process.cwd(), 'src/tools')
  const names: string[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(dir, file), 'utf8')
    for (const m of src.matchAll(/server\.registerTool\(\s*\n\s*"([a-z_]+)"/g)) {
      names.push(m[1])
    }
  }
  return names
}

describe('tool annotation coverage', () => {
  // The point of the table is that no tool ships without a deliberate
  // classification. Drift in either direction is a bug: an unannotated tool
  // silently inherits destructiveHint: true, and a stale entry hides that a
  // tool was renamed or removed.
  it('annotates every tool that is registered', () => {
    // Direction that matters most: a registered tool with no annotation silently
    // inherits destructiveHint: true and never gets auto-approved.
    const registered = new Set(registeredToolNames())
    const declared = new Set(Object.keys(TOOL_ANNOTATIONS))

    expect([...registered].filter((n) => !declared.has(n))).toEqual([])
  })

  it('has no annotation for a tool that no longer exists', () => {
    // The other direction: a stale entry hides that a tool was renamed or removed.
    const registered = new Set(registeredToolNames())
    expect(Object.keys(TOOL_ANNOTATIONS).filter((n) => !registered.has(n))).toEqual([])
  })

  it('annotates one more tool than the registry holds', () => {
    // list_tool_packages is registered unconditionally rather than through
    // TOOL_REGISTRY, because a filtered session still needs to be able to ask
    // what it is missing. So annotations cover the registry plus exactly that one.
    const registryNames = new Set(allToolNames())
    const extra = Object.keys(TOOL_ANNOTATIONS).filter((n) => !registryNames.has(n))
    expect(extra).toEqual(['list_tool_packages'])
  })

  it('gives every tool an explicit readOnlyHint', () => {
    // Omitting it is not neutral — it means "not read-only" by default, so a
    // genuinely safe tool would still be prompted for.
    const missing = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, a]) => typeof a.readOnlyHint !== 'boolean')
      .map(([name]) => name)
    expect(missing).toEqual([])
  })

  it('does not claim a read-only tool is also destructive', () => {
    const contradictory = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, a]) => a.readOnlyHint === true && (a.destructiveHint || a.idempotentHint))
      .map(([name]) => name)
    expect(contradictory).toEqual([])
  })

  it('sets destructiveHint explicitly on every write', () => {
    // destructiveHint DEFAULTS TO TRUE, so a non-destructive write that omits it
    // is advertised as dangerous and gets prompted unnecessarily.
    const missing = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, a]) => a.readOnlyHint === false && typeof a.destructiveHint !== 'boolean')
      .map(([name]) => name)
    expect(missing).toEqual([])
  })

  it('classifies the tools whose risk is least negotiable', () => {
    // Spot-checks rather than a full restatement of the table: these are the
    // ones where a wrong answer matters most.
    expect(annotationsFor('query_table').readOnlyHint).toBe(true)
    expect(annotationsFor('count_records').readOnlyHint).toBe(true)

    expect(annotationsFor('execute_script')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    })
    expect(annotationsFor('query_delete_records')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    })
    expect(annotationsFor('push_script').destructiveHint).toBe(true)
  })

  it('throws for an unknown tool rather than defaulting', () => {
    expect(() => annotationsFor('no_such_tool')).toThrow(/No annotations defined/)
  })

  it('throws for names that collide with Object.prototype', () => {
    // Bracket access would return the Object constructor here — truthy — and hand
    // back a function instead of throwing.
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(() => annotationsFor(name)).toThrow(/No annotations defined/)
    }
  })

  it('marks every tool open-world, since they all reach a live instance', () => {
    // Not a discriminator: the spec default is already true, so singling out a few
    // would be a no-op, and omitting it elsewhere would imply closed-world.
    const notOpen = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, a]) => a.openWorldHint !== true)
      .map(([name]) => name)
    expect(notOpen).toEqual([])
  })

  it('keeps a majority of the surface read-only, which is the point', () => {
    const readOnly = Object.values(TOOL_ANNOTATIONS).filter((a) => a.readOnlyHint).length
    // If this drops sharply, either the classification got sloppy or the surface
    // genuinely changed character — both worth a human looking.
    expect(readOnly).toBeGreaterThan(40)
  })
})

describe('annotations over the wire', () => {
  // The table being right is not the same as the client receiving it. This
  // asserts what a host actually sees in tools/list.
  it('reaches the client through listTools', async () => {
    const { client } = await createTestClientServer((server) => {
      server.registerTool(
        'query_table',
        {
          annotations: annotationsFor('query_table'),
          title: 'Query ServiceNow Table',
          description: 'read-only probe',
          inputSchema: { table: z.string() },
        },
        async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
      )
      server.registerTool(
        'execute_script',
        {
          annotations: annotationsFor('execute_script'),
          title: 'Execute Background Script',
          description: 'arbitrary code probe',
          inputSchema: { script: z.string() },
        },
        async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
      )
    })

    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

    expect(byName.query_table.annotations).toMatchObject({ readOnlyHint: true })
    expect(byName.execute_script.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    })
  })
})
