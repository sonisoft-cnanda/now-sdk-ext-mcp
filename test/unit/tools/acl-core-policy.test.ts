/**
 * The execute gate on code in an ACL lives in core (AclManager), not in this server's annotations: create_acl and
 * update_acl are plain writes so role-only ACLs work under NEX_POLICY_DENY=execute. This runs the REAL core against
 * the same installed policy the guard uses, so a core regression that let code through fails here too. AclManager
 * checks before it reads anything on create, so no instance is reached.
 */
import { afterEach, describe, expect, it } from '@jest/globals'
import { AclManager, ServiceNowInstance, denyLayer, grantLayer, installPolicy, isPolicyRefusal, resetPolicyForTests } from '@sonisoft/now-sdk-ext-core'

afterEach(() => resetPolicyForTests())

const target = { scope: { scope: 'x_app' }, updateSet: 'c'.repeat(32) }
const instance = () => new ServiceNowInstance({ alias: 'policy-test-unreachable', host: 'https://policy-test.invalid' })

describe('core refuses code on an ACL under an execute deny', () => {
  it('refuses a script and a javascript: condition before reaching the instance', async () => {
    installPolicy([denyLayer('test-deny', ['execute']), grantLayer('default', ['write', 'execute'])])
    for (const code of [{ script: 'answer = true;' }, { condition: 'sys_id=javascript:gs.getUserID()' }]) {
      const error = await new AclManager(instance()).create({ ...target, operation: 'read', table: 't', roles: ['itil'], ...code }).catch(e => e)
      expect(isPolicyRefusal(error)).toBe(true)
      expect(String(error.message)).toContain('runs on the instance at every check of the ACL')
    }
  })

  it('lets a role-only create past the gate under the same deny', async () => {
    installPolicy([denyLayer('test-deny', ['execute']), grantLayer('default', ['write', 'execute'])])
    // Past the gate it goes on to its first read, which fails for want of a credential (no network): what matters is
    // that it got that far rather than being refused by policy.
    const error = await new AclManager(instance()).create({ ...target, operation: 'read', table: 't', roles: ['itil'] }).catch(e => e)
    expect(isPolicyRefusal(error)).toBe(false)
    expect(error?.code).toMatch(/^NEX_AUTH_/)
  })
})
