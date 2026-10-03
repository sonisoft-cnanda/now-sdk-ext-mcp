import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Mock the credentials module before importing connection
jest.unstable_mockModule('@servicenow/sdk-cli/dist/auth/index.js', () => ({
  getCredentials: jest.fn(),
}))

// Mock the core library
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  resolveSessionCredentials: async (alias: string) => (await import('@servicenow/sdk-cli/dist/auth/index.js')).getCredentials(alias),
  ServiceNowInstance: jest.fn().mockImplementation((settings: any) => ({
    getHost: () => settings?.credential?.instanceUrl ?? 'https://test.service-now.com',
    getUserName: () => settings?.credential?.username ?? 'test-user',
    _settings: settings,
  })),
  // connection.ts logs through core now, so the mock has to carry the logging
  // surface too — otherwise the import fails before any assertion runs.
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  })),
  configureLogging: jest.fn(),
  redactValue: jest.fn((value: unknown) => value),
  flushLogs: jest.fn(() => Promise.resolve()),
}))

// Dynamic imports after mocks are set up (required for ESM)
const { getCredentials } = await import('@servicenow/sdk-cli/dist/auth/index.js')
const { ServiceNowInstance } = await import('@sonisoft/now-sdk-ext-core')
const { getServiceNowInstance, withConnectionRetry } = await import('../../../src/common/connection.js')

const mockGetCredentials = getCredentials as jest.MockedFunction<typeof getCredentials>

describe('getServiceNowInstance', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    // Reset the module-level cache by clearing mocks — the cache uses a Map
    // keyed by alias, so fresh mocks give fresh behavior
    process.env = { ...originalEnv }
    delete process.env.SN_AUTH_ALIAS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should resolve credentials using the provided alias', async () => {
    mockGetCredentials.mockResolvedValue({
      type: 'basic',
      username: 'admin',
      password: 'secret',
      instanceUrl: 'https://testinstance.service-now.com',
    })

    const instance = await getServiceNowInstance('testinstance')

    expect(mockGetCredentials).toHaveBeenCalledWith('testinstance')
    expect(instance).toBeDefined()
  })

  it('should fall back to SN_AUTH_ALIAS env var when no alias is passed', async () => {
    process.env.SN_AUTH_ALIAS = 'env-instance'
    mockGetCredentials.mockResolvedValue({
      type: 'basic',
      username: 'admin',
      password: 'secret',
      instanceUrl: 'https://env-instance.service-now.com',
    })

    const instance = await getServiceNowInstance()

    expect(mockGetCredentials).toHaveBeenCalledWith('env-instance')
    expect(instance).toBeDefined()
  })

  it('should throw when no alias is provided and env var is not set', async () => {
    await expect(getServiceNowInstance()).rejects.toThrow(
      'No instance specified'
    )
    expect(mockGetCredentials).not.toHaveBeenCalled()
  })

  it('should throw when credentials are not found for the alias', async () => {
    mockGetCredentials.mockResolvedValue(null)

    await expect(getServiceNowInstance('bad-alias')).rejects.toThrow(
      'No credentials found for auth alias "bad-alias"'
    )
  })

  it('should cache instances per alias', async () => {
    mockGetCredentials.mockResolvedValue({
      type: 'basic',
      username: 'admin',
      password: 'secret',
      instanceUrl: 'https://cached.service-now.com',
    })

    const first = await getServiceNowInstance('cached-test')
    const second = await getServiceNowInstance('cached-test')

    expect(first).toBe(second)
    // getCredentials should only be called once for the same alias
    expect(mockGetCredentials).toHaveBeenCalledTimes(1)
  })

  it('should maintain separate cache entries for different aliases', async () => {
    mockGetCredentials.mockImplementation(async (alias: string) => ({
      type: 'basic',
      username: 'admin',
      password: 'secret',
      instanceUrl: `https://${alias}.service-now.com`,
    }))

    const instanceA = await getServiceNowInstance('instance-a')
    const instanceB = await getServiceNowInstance('instance-b')

    expect(instanceA).not.toBe(instanceB)
    expect(mockGetCredentials).toHaveBeenCalledTimes(2)
    expect(mockGetCredentials).toHaveBeenCalledWith('instance-a')
    expect(mockGetCredentials).toHaveBeenCalledWith('instance-b')
  })

  it.each(['explicit', 'environment'])('binds the credential provider to the resolved %s alias', async (selection) => {
    const alias = `provider-${selection}`
    process.env.SN_AUTH_ALIAS = alias
    const initial = {
      type: 'basic' as const,
      username: 'fixture-user',
      password: 'fabricated-initial',
      instanceUrl: 'https://fixture.invalid',
    }
    const renewed = { ...initial, password: 'fabricated-renewed' }
    mockGetCredentials.mockResolvedValueOnce(initial).mockResolvedValueOnce(renewed)

    await getServiceNowInstance(selection === 'explicit' ? alias : undefined)
    process.env.SN_AUTH_ALIAS = 'changed-after-resolution'
    const settings = jest.mocked(ServiceNowInstance).mock.calls[0]![0]

    expect(settings.credential).toEqual(initial)
    expect(typeof settings.credentialProvider).toBe('function')
    await expect(settings.credentialProvider!()).resolves.toEqual(renewed)
    expect(mockGetCredentials.mock.calls).toEqual([[alias], [alias]])
  })

  it.each(['NEX_AUTH_REAUTH_REQUIRED', 'NEX_AUTH_TEMPORARY', 'NEX_SESSION_EXPIRED'])('does not replay an operation or evict its session for %s', async (code) => {
    const alias = `no-replay-${code}`
    mockGetCredentials.mockResolvedValue({
      type: 'basic',
      username: 'fixture-user',
      password: 'fabricated',
      instanceUrl: 'https://fixture.invalid',
    })
    const cached = await getServiceNowInstance(alias)
    const error = Object.assign(new Error('fetch failed: ECONNRESET'), { code })
    const operation = jest.fn<() => Promise<void>>().mockRejectedValue(error)

    await expect(withConnectionRetry(alias, operation)).rejects.toBe(error)

    expect(operation).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledWith(cached)
    expect(await getServiceNowInstance(alias)).toBe(cached)
    expect(mockGetCredentials).toHaveBeenCalledTimes(1)
  })

  it('rethrows a scope error unchanged, without replaying the operation', async () => {
    // execute_script recognises core's ScriptScopeError by `code`, so the wrapper
    // must hand back the very same object rather than a rebuilt one.
    const alias = 'scope-error'
    mockGetCredentials.mockResolvedValue({
      type: 'basic',
      username: 'fixture-user',
      password: 'fabricated',
      instanceUrl: 'https://fixture.invalid',
    })
    const cached = await getServiceNowInstance(alias)
    const error = Object.assign(new Error("No application with scope 'x_typo' exists on this instance."), {
      code: 'NEX_SCRIPT_SCOPE_UNAVAILABLE',
      reason: 'SCOPE_NOT_FOUND',
    })
    const operation = jest.fn<() => Promise<void>>().mockRejectedValue(error)

    await expect(withConnectionRetry(alias, operation)).rejects.toBe(error)

    expect(operation).toHaveBeenCalledTimes(1)
    expect(await getServiceNowInstance(alias)).toBe(cached)
  })

  it('still retries a transport failure once with a fresh instance', async () => {
    const alias = 'retry-transport'
    mockGetCredentials.mockResolvedValue({
      type: 'basic',
      username: 'fixture-user',
      password: 'fabricated',
      instanceUrl: 'https://fixture.invalid',
    })
    const error = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    const operation = jest.fn<(instance: InstanceType<typeof ServiceNowInstance>) => Promise<string>>()
      .mockRejectedValueOnce(error).mockResolvedValueOnce('recovered')

    await expect(withConnectionRetry(alias, operation)).resolves.toBe('recovered')

    expect(operation).toHaveBeenCalledTimes(2)
    expect(mockGetCredentials.mock.calls).toEqual([[alias], [alias]])
    expect(operation.mock.calls[0]![0]).not.toBe(operation.mock.calls[1]![0])
  })
})
