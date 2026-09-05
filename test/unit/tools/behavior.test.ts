import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { ServiceNowInstance, TableBehaviorOptions, TableBehaviorResult, BehaviorDetailOptions, BehaviorDetailsResult, BehaviorReference } from '@sonisoft/now-sdk-ext-core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestClientServer } from '../../helpers/mcp-test-helpers.js';

const discover = jest.fn<(table: string, options: TableBehaviorOptions) => Promise<TableBehaviorResult>>();
const details = jest.fn<(references: BehaviorReference[], options: BehaviorDetailOptions) => Promise<BehaviorDetailsResult>>();
const retry = jest.fn<(alias: string | undefined, operation: (instance: ServiceNowInstance) => Promise<unknown>) => Promise<unknown>>();
jest.unstable_mockModule('@sonisoft/now-sdk-ext-core', () => ({
  BEHAVIOR_CATEGORIES: ['business_rules', 'ui_actions', 'client_scripts', 'ui_policies', 'data_policies', 'workflows', 'flows', 'state_models'],
  TableBehaviorDiscovery: jest.fn().mockImplementation(() => ({ discoverTableBehavior: discover, getBehaviorDetails: details })),
}));
jest.unstable_mockModule('../../../src/common/connection.js', () => ({ withConnectionRetry: retry }));
const { registerDiscoverTableBehaviorTool, registerGetBehaviorDetailsTool } = await import('../../../src/tools/behavior.js');
let client: Client;
let server: McpServer;
const empty: TableBehaviorResult = { table: 'incident', ancestors: ['task'], requestedDetails: [], categories: [], dependencies: [], warnings: [], visibility: 'accessible_configuration' };

beforeEach(async () => {
  jest.clearAllMocks();
  retry.mockImplementation(async (_alias, operation) => operation({} as ServiceNowInstance));
  discover.mockResolvedValue(empty);
  details.mockResolvedValue({ items: [], dependencies: [], remainingReferences: [], requestedDetails: [], warnings: [], visibility: 'accessible_configuration' });
  ({ client, server } = await createTestClientServer(sn => { registerDiscoverTableBehaviorTool(sn); registerGetBehaviorDetailsTool(sn); }));
});
afterEach(async () => { await client.close(); await server.close(); });

describe('behavior tools through MCP', () => {
  it('registers both tools as read-only', async () => {
    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name)).toEqual(['discover_table_behavior', 'get_behavior_details']);
    expect(result.tools.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
  });
  it('maps optional discovery controls and returns the core structured result', async () => {
    const result = await client.callTool({ name: 'discover_table_behavior', arguments: { instance: 'dev', table: 'incident', categories: ['business_rules'], details: ['scripts', 'dependencies'], dependency_depth: 1, include_inactive: true, include_inherited: false, max_bytes: 4096 } });
    expect(retry.mock.calls[0][0]).toBe('dev');
    expect(discover).toHaveBeenCalledWith('incident', expect.objectContaining({ categories: ['business_rules'], details: ['scripts', 'dependencies'], dependencyDepth: 1, includeInactive: true, includeInherited: false, maxBytes: 4096 }));
    expect(result.structuredContent).toEqual(empty);
  });
  it('accepts source references unchanged from discovery', async () => {
    const references: BehaviorReference[] = [{ kind: 'business_rules', sourceTable: 'sys_script', sysId: 'a'.repeat(32) }];
    await client.callTool({ name: 'get_behavior_details', arguments: { references, details: ['scripts'] } });
    expect(details).toHaveBeenCalledWith(references, expect.objectContaining({ details: ['scripts'] }));
    expect(discover).not.toHaveBeenCalled();
  });
  it('rejects invalid input before reaching core', async () => {
    const result = await client.callTool({ name: 'discover_table_behavior', arguments: { table: 'incident^ORactive=true', limit: 201 } });
    expect(result.isError).toBe(true);
    expect(retry).not.toHaveBeenCalled();
  });
  it.each(['sys_script^ORactive=true', '../sys_user', ''])('rejects malformed source tables before connecting: %s', async sourceTable => {
    const result = await client.callTool({ name: 'get_behavior_details', arguments: { references: [{ kind: 'business_rules', sourceTable, sysId: 'a'.repeat(32) }] } });
    expect(result.isError).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
  });
  it('surfaces read failures without claiming an empty inventory', async () => {
    discover.mockRejectedValue(new Error('Authentication failed'));
    const result = await client.callTool({ name: 'discover_table_behavior', arguments: { table: 'incident' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
  it('keeps unexpected non-Error throws out of tool output', async () => {
    discover.mockRejectedValue('fixture-behavior-password');
    const result = await client.callTool({ name: 'discover_table_behavior', arguments: { table: 'incident' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Unknown error');
    expect(JSON.stringify(result.content)).not.toContain('fixture-behavior-password');
  });
  it('calls out partial categories and retains continuation metadata', async () => {
    discover.mockResolvedValue({ ...empty, categories: [{ category: 'flows', status: 'partial', items: [], warnings: [{ code: 'truncated', message: 'Continue' }], nextCursor: 'cursor' }] });
    const result = await client.callTool({ name: 'discover_table_behavior', arguments: { table: 'incident' } });
    expect(JSON.stringify(result.content)).toContain('Incomplete categories: flows');
    expect(JSON.stringify(result.structuredContent)).toContain('nextCursor');
  });
  it('calls out a remaining batch even when no top-level warning is returned', async () => {
    const references: BehaviorReference[] = [{ kind: 'business_rules', sourceTable: 'sys_script', sysId: 'a'.repeat(32) }];
    details.mockResolvedValue({ items: [], dependencies: [], remainingReferences: references, requestedDetails: [], warnings: [], visibility: 'accessible_configuration' });
    const result = await client.callTool({ name: 'get_behavior_details', arguments: { references } });
    expect(JSON.stringify(result.content)).toContain('Incomplete batch: 1');
    expect(JSON.stringify(result.content)).toContain('Retry remainingReferences');
    expect(result.structuredContent).toMatchObject({ remainingReferences: references });
  });
  it('surfaces item-level omissions in the text summary', async () => {
    const reference: BehaviorReference = { kind: 'business_rules', sourceTable: 'sys_script', sysId: 'a'.repeat(32) };
    details.mockResolvedValue({ items: [{ reference, name: 'Rule', configuration: {}, scriptFields: ['script'], warnings: [{ code: 'missing_fields', message: 'Script unavailable' }] }], dependencies: [], remainingReferences: [], requestedDetails: ['scripts'], warnings: [], visibility: 'accessible_configuration' });
    const result = await client.callTool({ name: 'get_behavior_details', arguments: { references: [reference], details: ['scripts'] } });
    expect(JSON.stringify(result.content)).toContain('Inspect warnings for omissions');
  });
});
