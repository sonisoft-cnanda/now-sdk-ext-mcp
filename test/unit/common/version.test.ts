import { describe, it, expect } from '@jest/globals'
import { createRequire } from 'node:module'
import { readServerVersion } from '../../../src/common/version.js'

/**
 * The advertised version is what clients receive in the initialize handshake.
 * It had drifted to "1.0.0-alpha.0" while the package was on 4.x, so this exists
 * to make that regression impossible to reintroduce silently.
 */
describe('readServerVersion', () => {
  it('matches package.json exactly', () => {
    const pkg = createRequire(import.meta.url)('../../../package.json') as { version: string }
    expect(readServerVersion()).toBe(pkg.version)
  })

  it('is a real semver, not a placeholder', () => {
    expect(readServerVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('is not the stale literal that used to be hard-coded', () => {
    expect(readServerVersion()).not.toBe('1.0.0-alpha.0')
  })
})
