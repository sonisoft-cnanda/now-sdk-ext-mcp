/**
 * export_update_set's file write when a hard link is not possible (exFAT, some SMB/NFS mounts) or fails outright:
 * node:fs/promises is wrapped so `link` rejects, everything else is the real filesystem.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const real = await import('node:fs/promises')
let linkError: string | undefined
let beforeCopy: (() => void) | undefined
jest.unstable_mockModule('node:fs/promises', () => ({
  ...real,
  link: async (a: string, b: string) => {
    if (linkError) throw Object.assign(new Error(linkError), { code: linkError })
    return real.link(a, b)
  },
  copyFile: async (a: string, b: string, mode?: number) => { beforeCopy?.(); return real.copyFile(a, b, mode) },
}))
const mockWithConnectionRetry = jest.fn<(alias: any, op: any, options?: any) => Promise<any>>()
jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: mockWithConnectionRetry }))
const exportUpdateSet = jest.fn<(...a: any[]) => Promise<any>>()
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  WorkingSetManager: jest.fn(), UpdateSetExporter: jest.fn().mockImplementation(() => ({ exportUpdateSet })),
  WorkingSetError: class extends Error {}, UpdateSetExportError: class extends Error {},
  isPolicyRefusal: () => false, redactMessage: (m: string) => m,
  Logger: jest.fn().mockImplementation(() => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
  configureLogging: jest.fn(), redactValue: jest.fn((v: unknown) => v), flushLogs: jest.fn(() => Promise.resolve()),
}))
const { registerExportUpdateSetTool } = await import('../../../src/tools/working-set.js')

const SET = 'c'.repeat(32)
const result = { xml: '<unload>payload</unload>', source: 'local', kind: 'single', updateSet: { sysId: SET, name: 'S', state: 'complete', application: 'global' },
  sets: [], excluded: [], recordCount: 1, messages: [] }
let server: McpServer, client: Client, dir: string
beforeEach(async () => {
  linkError = undefined; beforeCopy = undefined
  mockWithConnectionRetry.mockImplementation(async (_a: any, op: any) => op({}))
  exportUpdateSet.mockResolvedValue(result)
  dir = mkdtempSync(join(tmpdir(), 'mcp-export-'))
  server = new McpServer({ name: 't', version: '1' }); registerExportUpdateSetTool(server)
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s)
  client = new Client({ name: 'c', version: '1' }); await client.connect(c)
})
afterEach(async () => { await client.close(); await server.close(); rmSync(dir, { recursive: true, force: true }) })
const call = async (output: string) => ((await client.callTool({ name: 'export_update_set', arguments: { sys_id: SET, output } })) as any).content[0].text as string

describe('export file write without hard links', () => {
  it('falls back to an exclusive copy, keeps 0600, and leaves no temporary file', async () => {
    linkError = 'EXDEV'
    const output = join(dir, 'set.xml')
    expect(await call(output)).toContain('Exported')
    expect(readFileSync(output, 'utf8')).toBe(result.xml)
    expect(statSync(output).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['set.xml'])
  })

  it('reports a file that appeared meanwhile as existing, without replacing it', async () => {
    linkError = 'ENOTSUP'
    const output = join(dir, 'set.xml')
    beforeCopy = () => writeFileSync(output, 'someone else')
    expect(await call(output)).toContain('output_exists')
    expect(readFileSync(output, 'utf8')).toBe('someone else')
    expect(readdirSync(dir)).toEqual(['set.xml'])
  })

  it('reports another link failure as a failed write and removes the temporary file', async () => {
    linkError = 'EIO'
    const text = await call(join(dir, 'set.xml'))
    expect(text).toContain('output_write_failed')
    expect(readdirSync(dir)).toEqual([])
  })
})
