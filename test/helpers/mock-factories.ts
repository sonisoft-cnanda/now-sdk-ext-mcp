import { jest } from '@jest/globals'

export function createMockServiceNowInstance(overrides?: Partial<{
  host: string;
  username: string;
}>) {
  return {
    getHost: jest.fn<() => string>().mockReturnValue(overrides?.host ?? 'https://test.service-now.com'),
    getUserName: jest.fn<() => string>().mockReturnValue(overrides?.username ?? 'test-user'),
  }
}

export function createMockCredentials(overrides?: Partial<{
  instanceUrl: string;
  password: string;
  type: string;
  username: string;
}>) {
  return {
    instanceUrl: overrides?.instanceUrl ?? 'https://test.service-now.com',
    password: overrides?.password ?? 'test-password',
    type: overrides?.type ?? 'basic',
    username: overrides?.username ?? 'test-user',
  }
}

export function createMockBackgroundScriptExecutor(scriptResults?: Array<{ line: string }>) {
  return {
    executeScript: jest.fn().mockResolvedValue({
      scriptResults: scriptResults ?? [{ line: 'test output' }],
      affectedRecords: null,
    }),
  }
}

export function createMockTestResult(overrides?: Partial<{
  test_name: string;
  status: string;
  run_time: string;
  test_value: string;
  sys_id: string;
  output: string;
}>) {
  return {
    test_name: overrides?.test_name ?? 'Sample ATF Test',
    status: overrides?.status ?? 'success',
    run_time: overrides?.run_time ?? '00:00:05',
    test: { value: overrides?.test_value ?? 'test-sys-id-123' },
    sys_id: overrides?.sys_id ?? 'result-sys-id-456',
    output: overrides?.output ?? 'Test completed successfully',
    end_time_millis: '1704067200000',
    execution_tracker: { value: 'tracker-123' },
    rollback_context: { value: 'rollback-123' },
    root_tracker_id: { value: 'root-123' },
  }
}

export function createMockTableApiResponse<T = Record<string, unknown>>(
  records: T[],
  overrides?: Partial<{
    status: number;
    statusText: string;
  }>
) {
  return {
    bodyObject: { result: records },
    data: { result: records },
    status: overrides?.status ?? 200,
    statusText: overrides?.statusText ?? 'OK',
    headers: {},
    config: {},
  }
}

export function createMockAtfTestRecords(count: number = 3) {
  return Array.from({ length: count }, (_, i) => ({
    sys_id: `atf-test-sys-id-${i + 1}`,
    name: `Test ${i + 1}: Sample ATF Test`,
    description: `This is the description for test ${i + 1}. It validates important functionality.`,
    active: 'true',
    category: 'Custom',
    sys_updated_on: '2024-01-15 10:00:00',
  }))
}

export function createMockSyslogRecords(count: number = 3) {
  return Array.from({ length: count }, (_, i) => ({
    sys_id: `syslog-sys-id-${i + 1}`,
    sys_created_on: `2024-01-15 10:${String(i).padStart(2, '0')}:00`,
    level: i === 0 ? 'error' : i === 1 ? 'warning' : 'info',
    message: `Sample log message ${i + 1}`,
    source: 'sys_script',
    sys_created_by: 'admin',
  }))
}

export function createMockSyslogAppScopeRecords(count: number = 2) {
  return Array.from({ length: count }, (_, i) => ({
    sys_id: `syslog-scope-sys-id-${i + 1}`,
    sys_created_on: `2024-01-15 10:${String(i).padStart(2, '0')}:00`,
    level: 'error',
    message: `Scoped app log message ${i + 1}`,
    source: 'sys_script',
    app_scope: 'x_myapp_custom',
    app_name: 'My Custom App',
    sys_created_by: 'admin',
  }))
}

export function createMockTestSuiteResult(overrides?: Partial<{
  sys_id: string;
  number: string;
  test_suite_value: string;
  status: string;
  success: string;
  run_time: string;
  success_count: string;
  failure_count: string;
  skip_count: string;
  error_count: string;
}>) {
  return {
    sys_id: overrides?.sys_id ?? 'suite-result-123',
    number: overrides?.number ?? 'SUITE0001',
    test_suite: { value: overrides?.test_suite_value ?? 'suite-123' },
    status: overrides?.status ?? 'success',
    success: overrides?.success ?? 'true',
    start_time: '2024-01-01 00:00:00',
    end_time: '2024-01-01 00:01:00',
    run_time: overrides?.run_time ?? '00:01:00',
    success_count: overrides?.success_count ?? '5',
    failure_count: overrides?.failure_count ?? '0',
    skip_count: overrides?.skip_count ?? '0',
    error_count: overrides?.error_count ?? '0',
    parent: '',
    base_suite_result: { value: '' },
    execution_tracker: { value: 'tracker-123' },
    schedule_run: { value: '' },
  }
}
