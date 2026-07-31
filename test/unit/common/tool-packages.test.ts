import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { resolveToolPackage, reportResolution } from '../../../src/common/tool-packages.js'
import { TOOL_PACKAGES } from '../../../src/config/tool-packages.js'
import { allToolNames } from '../../../src/tools/registry.js'
import { TOOL_ANNOTATIONS } from '../../../src/common/annotations.js'

describe('resolveToolPackage', () => {
  it('registers everything when unset — the default must not change behaviour', () => {
    for (const unset of [undefined, '', '   ']) {
      const r = resolveToolPackage(unset)
      expect(r.names).toEqual(['full'])
      expect(r.tools.length).toBe(allToolNames().length)
      expect(r.fellBack).toBe(false)
    }
  })

  it('selects a named package', () => {
    const r = resolveToolPackage('service_desk')
    expect(r.names).toEqual(['service_desk'])
    expect(r.tools).toContain('find_task')
    expect(r.tools).not.toContain('execute_script')
    expect(r.tools.length).toBeLessThan(allToolNames().length)
  })

  it('unions comma-separated packages rather than intersecting them', () => {
    // Intersecting two role packages is almost always empty, which is never what
    // someone combining them meant.
    const desk = new Set(resolveToolPackage('service_desk').tools)
    const flow = new Set(resolveToolPackage('flow_developer').tools)
    const both = new Set(resolveToolPackage('service_desk,flow_developer').tools)

    for (const t of desk) expect(both.has(t)).toBe(true)
    for (const t of flow) expect(both.has(t)).toBe(true)
    expect(both.size).toBeGreaterThanOrEqual(Math.max(desk.size, flow.size))
  })

  it('tolerates whitespace around names', () => {
    expect(resolveToolPackage(' developer , flow_developer ').names).toEqual([
      'developer',
      'flow_developer',
    ])
  })

  describe('failure modes all degrade toward MORE tools', () => {
    // A typo that silently exposed a SMALLER surface would look like a broken
    // server — tools simply missing, with no error to search for.
    it('falls back to full for an unknown package', () => {
      const r = resolveToolPackage('nonsense')
      expect(r.fellBack).toBe(true)
      expect(r.names).toEqual(['full'])
      expect(r.unknownPackages).toEqual(['nonsense'])
      expect(r.tools.length).toBe(allToolNames().length)
    })

    it('keeps the valid half of a partly-unknown selection', () => {
      const r = resolveToolPackage('developer,nonsense')
      expect(r.fellBack).toBe(false)
      expect(r.names).toEqual(['developer'])
      expect(r.unknownPackages).toEqual(['nonsense'])
      expect(r.tools).toContain('execute_script')
    })

    it('falls back for names that collide with Object.prototype', () => {
      // TOOL_PACKAGES is an object literal, so TOOL_PACKAGES["constructor"] is the
      // Object constructor — truthy, with no .tools. Unguarded, iterating it threw
      // a TypeError during module load, BEFORE the uncaughtException handler was
      // registered, so MCP_TOOL_PACKAGE=constructor crashed the server outright.
      // A crash is strictly worse than falling back.
      for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
        const r = resolveToolPackage(name)
        expect(r.fellBack).toBe(true)
        expect(r.names).toEqual(['full'])
        expect(r.tools.length).toBe(allToolNames().length)
      }
    })

    it('never resolves to an empty tool set', () => {
      // A server with no tools is indistinguishable from a broken one.
      for (const sel of ['nonsense', ',,,', 'a,b,c']) {
        expect(resolveToolPackage(sel).tools.length).toBeGreaterThan(0)
      }
    })
  })

  describe('forward references to tools that do not exist yet', () => {
    it('skips them and reports them, rather than failing', () => {
      // service_desk names create_incident etc. from NEX-39, which is still open.
      const r = resolveToolPackage('service_desk')
      expect(r.unknownTools).toContain('create_incident')
      expect(r.tools).not.toContain('create_incident')
      expect(r.tools.length).toBeGreaterThan(0)
    })

    it('reports nothing unknown for a package naming only real tools', () => {
      expect(resolveToolPackage('flow_developer').unknownTools).toEqual([])
    })
  })

  describe('the readonly package', () => {
    it('is derived from annotations rather than hand-listed', () => {
      const expected = Object.entries(TOOL_ANNOTATIONS)
        .filter(([name, a]) => a.readOnlyHint === true && allToolNames().includes(name))
        .map(([name]) => name)
        .sort()

      expect(resolveToolPackage('readonly').tools).toEqual(expected)
    })

    it('contains nothing that can modify anything', () => {
      // The one package where a wrong entry is a safety problem, not an ergonomics one.
      for (const tool of resolveToolPackage('readonly').tools) {
        expect(TOOL_ANNOTATIONS[tool].readOnlyHint).toBe(true)
      }
    })
  })

  it('never resolves a name the registry cannot register', () => {
    // index.ts does TOOL_REGISTRY[name](server) directly, so a resolved name with
    // no registrar is a startup crash, not a missing tool. This caught exactly
    // that: @readonly was pulling in list_tool_packages, which is registered
    // unconditionally and is deliberately absent from the registry.
    const registry = new Set(allToolNames())
    for (const name of [...Object.keys(TOOL_PACKAGES), 'nonsense', 'developer,nonsense', '']) {
      for (const tool of resolveToolPackage(name).tools) {
        expect(registry.has(tool)).toBe(true)
      }
    }
  })

  it('resolves every configured package to at least one real tool', () => {
    // Catches a package that is entirely forward references, which would present
    // as an empty session.
    for (const name of Object.keys(TOOL_PACKAGES)) {
      expect(resolveToolPackage(name).tools.length).toBeGreaterThan(0)
    }
  })
})

describe('reportResolution', () => {
  let err: jest.SpiedFunction<typeof console.error>

  beforeEach(() => { err = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { err.mockRestore() })

  it('writes to stderr only — stdout is the JSON-RPC transport', () => {
    const out = jest.spyOn(console, 'log').mockImplementation(() => {})
    reportResolution(resolveToolPackage('developer'))
    expect(out).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    out.mockRestore()
  })

  it('names the available packages when one is unrecognised', () => {
    reportResolution(resolveToolPackage('nonsense'))
    const text = err.mock.calls.flat().join('\n')
    expect(text).toMatch(/unknown package/i)
    expect(text).toContain('service_desk')
    expect(text).toMatch(/falling back/i)
  })

  it('explains that skipped tools are expected, not a fault', () => {
    reportResolution(resolveToolPackage('service_desk'))
    const text = err.mock.calls.flat().join('\n')
    expect(text).toMatch(/has not landed yet/i)
  })

  it('always reports the active package and counts', () => {
    reportResolution(resolveToolPackage('developer'))
    const text = err.mock.calls.flat().join('\n')
    expect(text).toMatch(/active: developer/)
    expect(text).toMatch(/\d+ of \d+ tools registered/)
  })
})
