import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Mock the credentials module before importing connection
jest.unstable_mockModule('@servicenow/sdk-cli/dist/auth/index.js', () => ({
  getCredentials: jest.fn(),
}))

// Mock the core library
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  ServiceNowInstance: jest.fn().mockImplementation((settings: any) => ({
    getHost: () => settings?.credential?.instanceUrl ?? 'https://test.service-now.com',
    getUserName: () => settings?.credential?.username ?? 'test-user',
    _settings: settings,
  })),
}))

// Dynamic imports after mocks are set up (required for ESM)
const { getCredentials } = await import('@servicenow/sdk-cli/dist/auth/index.js')
const { getServiceNowInstance } = await import('../../../src/common/connection.js')

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
      instanceUrl: 'https://dev12345.service-now.com',
    })

    const instance = await getServiceNowInstance('dev12345')

    expect(mockGetCredentials).toHaveBeenCalledWith('dev12345')
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
})
