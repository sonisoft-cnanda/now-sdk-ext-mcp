/**
 * Elevation stays with the ACL tools. Elevated sessions are a property of the connection a tool asks
 * for, so "no other tool ever runs elevated" holds only while no other source asks for one. Scanned
 * from source, as annotations.test.ts does for registration, so a new caller cannot slip in unnoticed.
 */
import { describe, it, expect } from '@jest/globals'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolveToolPackage } from '../../../src/common/tool-packages.js'
import { TOOL_PACKAGES } from '../../../src/config/tool-packages.js'

const SRC = join(process.cwd(), 'src')
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [])

const READS = ['list_acls', 'get_acl', 'get_role_elevation']
const WRITES = ['create_acl', 'update_acl', 'delete_acl', 'add_acl_role', 'remove_acl_role']

describe('elevation stays with the ACL tools', () => {
  it('only connection.ts and tools/acl.ts mention elevated roles', () => {
    const mentioning = files(SRC).filter(f => /elevatedRoles|ELEVATED\b/.test(readFileSync(f, 'utf8')))
      .map(f => relative(SRC, f)).sort()
    expect(mentioning).toEqual(['common/connection.ts', 'tools/acl.ts'])
  })

  it('no other tool passes connection options to withConnectionRetry', () => {
    // A third argument is how a tool asks for an elevated connection.
    for (const file of files(join(SRC, 'tools')).filter(f => !f.endsWith('acl.ts'))) {
      const text = readFileSync(file, 'utf8')
      expect(text).not.toMatch(/ConnectionOptions/)
      expect(text).not.toMatch(/getServiceNowInstance\(/)
    }
  })
})

describe('ACL tools in packages', () => {
  it('readonly has the ACL reads and none of the writes', () => {
    const tools = resolveToolPackage('readonly').tools
    expect(tools).toEqual(expect.arrayContaining(READS))
    for (const write of WRITES) expect(tools).not.toContain(write)
  })

  it('developer and admin have every ACL tool', () => {
    for (const name of ['developer', 'admin']) expect(TOOL_PACKAGES[name].tools).toEqual(expect.arrayContaining([...READS, ...WRITES]))
  })
})
