import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const alias = "fixture-dev";
const fixturePassword = "fabricated-password-never-log";
const fixtureRecord = { sys_id: "0123456789abcdef0123456789abcdef", number: "INC0000001" };
const runDir = await mkdtemp(join(tmpdir(), "now-sdk-ext-mcp-credstore-eval-"));
const storePath = join(runDir, "credentials.json");
let client;
let transport;
let stderr = "";
const requests = [];

const mockInstance = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ result: [fixtureRecord] }));
});

try {
  await new Promise((resolve, reject) => {
    mockInstance.once("error", reject);
    mockInstance.listen(0, "127.0.0.1", resolve);
  });
  const address = mockInstance.address();
  assert(address && typeof address === "object");

  const keyStore = {
    [alias]: {
      alias,
      isDefault: true,
      creds: {
        type: "basic",
        instanceUrl: `http://127.0.0.1:${address.port}`,
        username: "fixture-user",
        password: fixturePassword,
      },
    },
  };
  await writeFile(storePath, JSON.stringify(keyStore), { mode: 0o600 });
  await chmod(storePath, 0o600);

  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...process.env,
      SN_AUTH_ALIAS: alias,
      SN_CRED_STORE_ENABLE: "1",
      SN_CRED_STORE: "file",
      SN_CRED_STORE_PATH: storePath,
      SN_CRED_STORE_DEBUG: "1",
    },
  });
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

  client = new Client({ name: "credstore-integration-eval", version: "1.0.0" });
  await client.connect(transport);

  const success = await client.callTool({
    name: "query_table",
    arguments: { instance: alias, table: "incident", fields: "sys_id,number", limit: 1 },
  });
  const successText = JSON.stringify(success);
  assert.equal(success.isError, undefined);
  assert.match(successText, /INC0000001/);
  assert(requests.some(({ url }) => /^\/api\/now\/table\/incident\?/.test(url ?? "")));

  const failure = await client.callTool({
    name: "query_table",
    arguments: { instance: "missing-fixture", table: "incident", limit: 1 },
  });
  const failureText = JSON.stringify(failure);
  assert.equal(failure.isError, true);
  // This is a stored-credential miss for an explicit alias, not the separate
  // no-alias-supplied path. The credstore shim owns this failure before
  // connection.ts can handle a null result, so assert the stable contract
  // instead of the dependency's exact prose.
  assert.match(failureText, /credential/i);
  assert.match(failureText, /missing-fixture/);

  const observableOutput = `${successText}\n${failureText}\n${stderr}`;
  assert(!observableOutput.includes(fixturePassword), "credential material crossed the MCP/log boundary");
  // Intentional 1.1.0 integration check: this diagnostic proves the file-store
  // shim was installed rather than silently falling back to the OS keyring.
  assert.match(stderr, /\[sn-credstore\] shim installed \(store: file/);

  process.stderr.write("credstore MCP eval passed: alias resolution, read-only tool use, failure handling, and secret non-disclosure\n");
} catch (error) {
  process.stderr.write(stderr);
  assert(!stderr.includes(fixturePassword), "credential material appeared in startup diagnostics");
  throw error;
} finally {
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await new Promise((resolve) => mockInstance.close(resolve));
  await rm(runDir, { recursive: true, force: true });
}
