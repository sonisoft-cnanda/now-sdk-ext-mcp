import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Creates a connected MCP client+server pair using InMemoryTransport.
 * The server has tools registered via the provided setup function.
 *
 * Returns both client and server so tests can call tools through
 * the full MCP protocol stack and clean up afterwards.
 */
export async function createTestClientServer(
  registerTools: (server: McpServer) => void
): Promise<{ client: Client; server: McpServer }> {
  const server = new McpServer({
    name: "now-sdk-ext-mcp",
    version: "1.0.0-alpha.0",
  });

  registerTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);

  return { client, server };
}
