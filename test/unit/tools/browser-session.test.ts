import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: jest.fn() }))
// The private directory lives under os.tmpdir(); point that at the test's own directory (the sandbox's process.env
// does not reach the native lookup, so TMPDIR cannot be used).
let fakeTmp = ''
const realOs = await import('node:os')
jest.unstable_mockModule('node:os', () => ({ ...realOs, default: realOs, tmpdir: () => fakeTmp || realOs.tmpdir() }))

const createBrowserSession = jest.fn<(...a: any[]) => Promise<any>>()
class SessionAuthError extends Error { constructor(public code: string, public remediation: string) { super(code) } }

jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  createBrowserSession,
  SessionAuthError,
  redactMessage: (m: string) => m,
  isPolicyRefusal: () => false,
  // Modules imported alongside (working-set, logging).
  WorkingSetManager: jest.fn(), UpdateSetExporter: jest.fn(), WorkingSetError: class extends Error {}, UpdateSetExportError: class extends Error {},
  Logger: jest.fn().mockImplementation(() => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() })),
  configureLogging: jest.fn(), redactValue: jest.fn((v: unknown) => v), flushLogs: jest.fn(() => Promise.resolve()),
}))

const tools = await import('../../../src/tools/browser-session.js')
const { TOOL_ANNOTATIONS } = await import('../../../src/common/annotations.js')

const COOKIE = 'glide_session_store=SECRETVALUE'
const minted = () => ({ alias: 'dev', instanceUrl: 'https://dev.service-now.com', createdAt: 1, oauthExpiresAt: Date.UTC(2026, 10, 7) / 1000,
  storageState: { cookies: [{ name: 'glide_session_store', value: 'SECRETVALUE', domain: 'dev.service-now.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] } })

let root: string, server: McpServer, client: Client
const saved = { dir: process.env.NEX_BROWSER_SESSION_DIR, alias: process.env.SN_AUTH_ALIAS }
beforeEach(async () => {
  jest.clearAllMocks()
  root = mkdtempSync(join(tmpdir(), 'bs-test-'))
  process.env.NEX_BROWSER_SESSION_DIR = root
  delete process.env.SN_AUTH_ALIAS
  createBrowserSession.mockResolvedValue(minted())
  server = new McpServer({ name: 't', version: '1' })
  for (const [n, r] of Object.entries(tools)) if (n.startsWith('register')) (r as (s: McpServer) => void)(server)
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s)
  client = new Client({ name: 'c', version: '1' }); await client.connect(c)
})
afterEach(async () => {
  await client.close(); await server.close()
  rmSync(root, { recursive: true, force: true })
  fakeTmp = ''
  for (const [key, value] of [['NEX_BROWSER_SESSION_DIR', saved.dir], ['SN_AUTH_ALIAS', saved.alias]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args })
  return { text: r.content[0].text as string, isError: r.isError === true }
}
const asRoot = process.getuid?.() === 0

describe('create_browser_session', () => {
  it('writes the storage state to a new 0600 file and returns its path, never the cookies', async () => {
    const { text, isError } = await call('create_browser_session', { instance: 'dev', name: 'ui-check' })
    expect(isError).toBe(false)
    const path = join(root, 'ui-check.json')
    expect(createBrowserSession).toHaveBeenCalledWith({ alias: 'dev' })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(minted().storageState)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(text).toContain(`written to ${path} (mode 0600, 1 cookie(s))`)
    expect(text).toContain('expires 2026-11-07T00:00:00.000Z')
    expect(text).not.toContain('SECRETVALUE')
    expect(text).not.toContain(COOKIE)
    expect(readdirSync(root)).toEqual(['ui-check.json'])
  })

  it('names the file from the alias by default, and never replaces one', async () => {
    process.env.SN_AUTH_ALIAS = 'my.alias'
    await call('create_browser_session', {})
    expect(readdirSync(root)[0]).toMatch(/^my_alias-\d{4}-\d\d-\d\dT[\d-]+Z\.json$/)
    writeFileSync(join(root, 'taken.json'), 'keep')
    const logins = createBrowserSession.mock.calls.length
    const again = await call('create_browser_session', { instance: 'dev', name: 'taken' })
    expect(again.isError).toBe(true)
    expect(again.text).toContain('session_exists')
    // Refused before logging in: no UI session opened for nothing.
    expect(createBrowserSession.mock.calls.length).toBe(logins)
    // Milliseconds are read as milliseconds; a nonsense expiry is left out rather than failing after the write.
    createBrowserSession.mockResolvedValueOnce({ ...minted(), oauthExpiresAt: Date.UTC(2026, 10, 7) })
    expect((await call('create_browser_session', { instance: 'dev', name: 'ms' })).text).toContain('expires 2026-11-07T00:00:00.000Z')
    createBrowserSession.mockResolvedValueOnce({ ...minted(), oauthExpiresAt: Number.MAX_VALUE })
    const odd = await call('create_browser_session', { instance: 'dev', name: 'odd' })
    expect(odd.isError).toBe(false)
    expect(odd.text).not.toContain('expires')
    expect(readFileSync(join(root, 'taken.json'), 'utf8')).toBe('keep')
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('refuses a misconfigured directory before logging in', async () => {
    for (const dir of ['', 'relative/dir', join(root, 'missing')]) {
      process.env.NEX_BROWSER_SESSION_DIR = dir
      const r = await call('create_browser_session', { instance: 'dev' })
      expect(r.text).toContain('session_dir_misconfigured')
    }
    expect(createBrowserSession).not.toHaveBeenCalled()
    expect((await call('create_browser_session', { instance: 'dev', name: '../escape' })).isError).toBe(true)
  })

  ;(asRoot ? it.skip : it)('uses a private temp directory, refusing one open to others', async () => {
    delete process.env.NEX_BROWSER_SESSION_DIR
    fakeTmp = root
    const r = await call('create_browser_session', { instance: 'dev', name: 'one' })
    const dir = join(root, `nex-browser-sessions-${process.getuid?.()}`)
    expect(r.text).toContain(join(dir, 'one.json'))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    chmodSync(dir, 0o755)
    expect((await call('create_browser_session', { instance: 'dev', name: 'two' })).text).toContain('session_dir_unsafe')
    expect(existsSync(join(dir, 'two.json'))).toBe(false)
  })

  ;(asRoot ? it.skip : it)('resolves a temp directory reached through a link, so its files can be deleted', async () => {
    delete process.env.NEX_BROWSER_SESSION_DIR
    const real = join(root, 'real'); mkdirSync(real, { mode: 0o700 })
    symlinkSync(real, join(root, 'via-link'))
    fakeTmp = join(root, 'via-link')
    const created = await call('create_browser_session', { instance: 'dev', name: 'linked' })
    const path = /written to (\S+)/.exec(created.text)?.[1] as string
    expect(path).toBe(join(real, `nex-browser-sessions-${process.getuid?.()}`, 'linked.json'))
    expect((await call('delete_browser_session', { path })).isError).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  ;(asRoot ? it.skip : it)('refuses a pre-made link in place of the private directory, and a configured directory open to others', async () => {
    delete process.env.NEX_BROWSER_SESSION_DIR
    fakeTmp = root
    const elsewhere = join(root, 'elsewhere'); mkdirSync(elsewhere, { mode: 0o700 })
    symlinkSync(elsewhere, join(root, `nex-browser-sessions-${process.getuid?.()}`))
    expect((await call('create_browser_session', { instance: 'dev' })).text).toContain('session_dir_unsafe')
    const open = join(root, 'open'); mkdirSync(open, { mode: 0o755 }); chmodSync(open, 0o755)
    process.env.NEX_BROWSER_SESSION_DIR = open
    expect((await call('create_browser_session', { instance: 'dev' })).text).toContain('session_dir_misconfigured')
    expect(createBrowserSession).not.toHaveBeenCalled()
  })

  it('falls back to a deletable default name when the alias would not make one', async () => {
    process.env.SN_AUTH_ALIAS = '_odd.alias'
    const created = await call('create_browser_session', {})
    const path = /written to (\S+)/.exec(created.text)?.[1] as string
    expect(path).toMatch(/\/session-\d{4}-[\dT-]+Z\.json$/)
    expect((await call('delete_browser_session', { path })).isError).toBe(false)
  })

  it('needs write and execute on the instance to create, and nothing to delete', () => {
    expect(TOOL_ANNOTATIONS.create_browser_session).toMatchObject({ verbs: ['write', 'execute'], target: 'instance', destructiveHint: true })
    expect(TOOL_ANNOTATIONS.delete_browser_session).toMatchObject({ target: 'local' })
  })

  it('reports a login failure with its remediation, writing nothing', async () => {
    createBrowserSession.mockRejectedValueOnce(new SessionAuthError('NEX_AUTH_REAUTH_REQUIRED', 'Run nex auth open to sign in again.'))
    const r = await call('create_browser_session', { instance: 'dev' })
    expect(r.text).toContain('NEX_AUTH_REAUTH_REQUIRED: Run nex auth open to sign in again.')
    expect(readdirSync(root)).toEqual([])
    expect((await call('create_browser_session', {})).text).toContain('SN_AUTH_ALIAS is not set')
  })
})

describe('delete_browser_session', () => {
  it('deletes a session file it wrote', async () => {
    await call('create_browser_session', { instance: 'dev', name: 'gone' })
    const r = await call('delete_browser_session', { path: join(root, 'gone.json') })
    expect(r.text).toBe(`Deleted the browser session file ${join(root, 'gone.json')}.`)
    expect(readdirSync(root)).toEqual([])
    expect((await call('delete_browser_session', { path: join(root, 'gone.json') })).text).toContain('no session file')
  })

  it('deletes only its own storage-state files from the directory', async () => {
    writeFileSync(join(root, 'package.json'), '{"name":"x"}', { mode: 0o600 })
    writeFileSync(join(root, 'shared.json'), '{"cookies":[],"origins":[]}', { mode: 0o644 }); chmodSync(join(root, 'shared.json'), 0o644)
    expect((await call('delete_browser_session', { path: join(root, 'package.json') })).text).toContain('not_a_session_file')
    if (!asRoot) expect((await call('delete_browser_session', { path: join(root, 'shared.json') })).text).toContain('not_a_session_file')
    expect(existsSync(join(root, 'package.json'))).toBe(true)
    expect(existsSync(join(root, 'shared.json'))).toBe(true)
  })

  it('refuses anything outside the session directory, a non-json file, and a link', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'bs-out-'))
    try {
      writeFileSync(join(outside, 'x.json'), '{}')
      writeFileSync(join(root, 'notes.txt'), 'keep')
      mkdirSync(join(root, 'sub')); writeFileSync(join(root, 'sub', 'y.json'), '{}')
      symlinkSync(join(outside, 'x.json'), join(root, 'link.json'))
      for (const path of [join(outside, 'x.json'), join(root, 'notes.txt'), join(root, 'sub', 'y.json'), `${root}/../${root.split('/').pop()}/link.json`, 'gone.json']) {
        const r = await call('delete_browser_session', { path })
        expect(r.isError).toBe(true)
      }
      expect(existsSync(join(outside, 'x.json'))).toBe(true)
      expect(existsSync(join(root, 'notes.txt'))).toBe(true)
      expect(existsSync(join(root, 'sub', 'y.json'))).toBe(true)
      expect((await call('delete_browser_session', { path: join(root, 'link.json') })).text).toContain('not_a_session_file')
      expect(existsSync(join(outside, 'x.json'))).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
