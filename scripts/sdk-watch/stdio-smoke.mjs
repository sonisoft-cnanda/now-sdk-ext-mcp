#!/usr/bin/env node
// Drive the built MCP server over stdio the way a client does, after an SDK/dependency bump.
//
// Usage:
//   SN_INSTANCE_ALIAS=<non-prod alias> SN_CRED_STORE=file node scripts/sdk-watch/stdio-smoke.mjs
//     optional: QA_APP_SCOPE=<a sys_app scope>, QA_STORE_APP_SCOPE=<a sys_store_app scope>
//   node scripts/sdk-watch/stdio-smoke.mjs --startup-only
//     no instance: start with the credential store enabled, handshake, list tools. Pair with
//     NODE_PATH=<prefix>/node_modules to simulate a global now-sdk of a given version.
//
// Besides tool results, every session asserts two server-wide invariants:
//   - stdout carries only JSON-RPC. A stray line (e.g. the SDK logger's "[now-sdk] Access
//     Token has expired, refreshing token", which it writes to stdout by default) corrupts
//     the client's stream.
//   - no telemetry module loads (SDK 4.12+ ships posthog-node under sdk-build-core).
// Needs `npm run build`. Runs only reads and gs.info() scripts; never production.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const startupOnly = process.argv.includes('--startup-only');
const alias = process.env.SN_INSTANCE_ALIAS?.trim();
if (!startupOnly && !alias) {
    process.stderr.write('Set SN_INSTANCE_ALIAS to a configured, non-production alias (or pass --startup-only).\n');
    process.exit(2);
}
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'mcp-smoke-'));
const hook = join(work, 'telemetry-hook.cjs');
// module.registerHooks resolves both require() and import(), so it also sees the SDK's
// `await import('posthog-node')`, which a Module._load patch (CommonJS only) would miss.
writeFileSync(hook, `require('node:module').registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/posthog|telemetry/i.test(specifier)) process.stderr.write('TELEMETRY_LOAD ' + specifier + '\\n');
    return nextResolve(specifier, context);
  },
});\n`);

const env = {
    ...process.env,
    SN_CRED_STORE_ENABLE: '1',
    SN_AUTH_ALIAS: alias || 'qa-startup-only',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${hook}`.trim(),
};
if (startupOnly) {
    env.SN_CRED_STORE = 'file';
    env.SN_CRED_STORE_PATH = join(work, 'credentials.json');
}
const server = spawn(process.execPath, [join(root, 'dist/index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
server.stderr.on('data', (d) => { stderr += d; });
const nonJson = [];
const pending = new Map();
createInterface({ input: server.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    try {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
    } catch {
        nonJson.push(line);
    }
});
let exited = null;
server.on('exit', (code) => {
    exited = code;
    for (const resolveCall of pending.values()) resolveCall({ error: { message: `server exited ${code}` } });
});
let nextId = 0;
const rpc = (method, params) => new Promise((resolveCall) => {
    const id = ++nextId;
    pending.set(id, resolveCall);
    setTimeout(() => resolveCall({ error: { message: `timeout on ${method}` } }), 120_000);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});
const text = (r) => r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? r);

const checks = [];
const record = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    process.stderr.write(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}\n`);
};

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sdk-qa', version: '1' } });
record('server starts with the credential store enabled', Boolean(init.result), init.result ? init.result.serverInfo?.name : `${text(init)} ${stderr.split('\n').slice(0, 3).join(' ')}`);
if (init.result) {
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = await rpc('tools/list', {});
    record('tools/list', (tools.result?.tools?.length ?? 0) > 0, `${tools.result?.tools?.length ?? 0} tools`);

    if (!startupOnly) {
        const marker = `SDK_QA_${Date.now()}`;
        const script = `gs.info('${marker}=' + gs.getCurrentScopeName());`;
        const q = await rpc('tools/call', { name: 'query_table', arguments: { table: 'sys_scope', query: 'sys_id=global', fields: 'sys_id,name', limit: 1 } });
        record('query_table reads the Global scope', !q.result?.isError && /"sys_id": "global"/.test(text(q)), text(q).replace(/\s+/g, ' ').slice(0, 120));
        const exec = (scope) => rpc('tools/call', { name: 'execute_script', arguments: { script, scope } });
        const g = await exec('global');
        record('execute_script global runs in Global', !g.result?.isError && text(g).includes(`${marker}=rhino.global`), text(g).slice(0, 120));
        const u = await exec('x_sdk_qa_no_such_scope');
        record('execute_script refuses an unknown scope', Boolean(u.result?.isError) && /^Script not run\. No application with scope/.test(text(u)), text(u).slice(0, 120));
        if (process.env.QA_STORE_APP_SCOPE) {
            const s = await exec(process.env.QA_STORE_APP_SCOPE);
            record(`execute_script refuses store app ${process.env.QA_STORE_APP_SCOPE}`, Boolean(s.result?.isError) && /sys_store_app/.test(text(s)), text(s).slice(0, 120));
        }
        if (process.env.QA_APP_SCOPE) {
            const a = await exec(process.env.QA_APP_SCOPE);
            record(`execute_script runs in sys_app ${process.env.QA_APP_SCOPE}`, !a.result?.isError && text(a).includes(`${marker}=${process.env.QA_APP_SCOPE}`), text(a).slice(-120));
        }
    }
}
await new Promise((r) => setTimeout(r, 500));
record('stdout carries only JSON-RPC', nonJson.length === 0, nonJson.length ? `non-JSON lines: ${JSON.stringify(nonJson.slice(0, 3))}` : 'clean');
const telemetry = stderr.split('\n').filter((l) => l.startsWith('TELEMETRY_LOAD'));
record('no telemetry module loaded', telemetry.length === 0, telemetry.length ? telemetry.slice(0, 3).join('; ') : 'none');

if (exited === null) server.kill();
rmSync(work, { recursive: true, force: true });
const pass = checks.every((c) => c.pass);
process.stdout.write(`${JSON.stringify({ alias: alias ?? null, startupOnly, pass, checks }, null, 2)}\n`);
process.exit(pass ? 0 : 1);
