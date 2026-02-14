// Manual mock for @sonisoft/now-sdk-ext-core

export class ServiceNowInstance {
  private host: string
  private username: string

  constructor(settings?: any) {
    this.host = settings?.credential?.instanceUrl || 'https://test.service-now.com'
    this.username = settings?.credential?.username || 'test-user'
  }

  getHost = jest.fn().mockImplementation(() => this.host)
  getUserName = jest.fn().mockImplementation(() => this.username)
}

export class BackgroundScriptExecutor {
  executeScript: ReturnType<typeof jest.fn>

  constructor(_instance?: any, _scope?: string) {
    this.executeScript = jest.fn(() => Promise.resolve({
      scriptResults: [{ line: 'test output' }],
      affectedRecords: null,
    }))
  }
}

export class ATFTestExecutor {
  executeTest: ReturnType<typeof jest.fn>
  executeTestSuiteAndWait: ReturnType<typeof jest.fn>
  executeTestSuiteByNameAndWait: ReturnType<typeof jest.fn>

  constructor(_instance?: any) {
    this.executeTest = jest.fn(() => Promise.resolve({
      test_name: 'Test Mock',
      status: 'success',
      run_time: '00:00:05',
      test: { value: 'abc123' },
      sys_id: 'result123',
      output: 'Test passed',
    }))
    this.executeTestSuiteAndWait = jest.fn(() => Promise.resolve({
      sys_id: 'suite-result-123',
      number: 'SUITE0001',
      test_suite: { value: 'suite123' },
      status: 'success',
      success: 'true',
      start_time: '2024-01-01 00:00:00',
      end_time: '2024-01-01 00:01:00',
      run_time: '00:01:00',
      success_count: '5',
      failure_count: '0',
      skip_count: '0',
      error_count: '0',
    }))
    this.executeTestSuiteByNameAndWait = jest.fn(() => Promise.resolve({
      sys_id: 'suite-result-456',
      number: 'SUITE0002',
      test_suite: { value: 'suite456' },
      status: 'success',
      success: 'true',
      start_time: '2024-01-01 00:00:00',
      end_time: '2024-01-01 00:01:00',
      run_time: '00:01:00',
      success_count: '3',
      failure_count: '0',
      skip_count: '1',
      error_count: '0',
    }))
  }
}

export class TableAPIRequest {
  get: ReturnType<typeof jest.fn>
  post: ReturnType<typeof jest.fn>
  put: ReturnType<typeof jest.fn>
  patch: ReturnType<typeof jest.fn>

  constructor(_instance?: any) {
    this.get = jest.fn(() => Promise.resolve({
      bodyObject: { result: [] },
      data: { result: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    }))
    this.post = jest.fn(() => Promise.resolve({
      bodyObject: { result: {} },
      data: { result: {} },
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {},
    }))
    this.put = jest.fn(() => Promise.resolve({
      bodyObject: { result: {} },
      data: { result: {} },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    }))
    this.patch = jest.fn(() => Promise.resolve({
      bodyObject: { result: {} },
      data: { result: {} },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    }))
  }
}

export class SyslogReader {
  querySyslog: ReturnType<typeof jest.fn>
  querySyslogAppScope: ReturnType<typeof jest.fn>

  constructor(_instance?: any) {
    this.querySyslog = jest.fn(() => Promise.resolve([]))
    this.querySyslogAppScope = jest.fn(() => Promise.resolve([]))
  }
}

export interface ServiceNowSettingsInstance {
  alias?: string
  credential: any
}
