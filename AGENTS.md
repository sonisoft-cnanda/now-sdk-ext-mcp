# AGENTS.md

Operating rules for automated agents working in this repository.

For architecture, layout and build commands, read [`CLAUDE.md`](./CLAUDE.md).
This file is only about the things that will bite you *here* and not elsewhere.

---

## What this repository is

An MCP server exposing ~86 ServiceNow tools to AI agents. It is launched as a
non-interactive child process, speaks JSON-RPC over stdio, and acts against real
instances with the launching user's credentials.

Two things follow, and both are unusual enough to be worth stating:

- **stdout is a protocol channel, not an output channel.**
- **The caller is a model, not a person.** Tool descriptions and result text are
  the entire interface. Prose here is not documentation *about* the product; it
  *is* the product.

---

## Hard rules

### 1. Never write to stdout

`console.log`, a stray `print`, a library that logs on import — any byte on
stdout that is not JSON-RPC corrupts the stream and breaks the client's parser,
usually with an error that points nowhere near the cause.

Diagnostics go to **stderr**, always:

```ts
console.error("[thing] message");
```

This is why `credstore-boot.ts` uses `process.stderr.write` and why the progress
helper swallows notification failures to stderr rather than surfacing them.

### 2. A tool's description is its implementation, as far as the model is concerned

Tools are hand-registered with a `title`, a `description`, and a zod
`inputSchema`. The model never reads the handler. If the description does not say
that a flow with approval steps must run in background mode, the model will not
know.

Two patterns already in the codebase, both worth continuing:

- **Explain the platform, not just the parameter.** `execute_script`'s
  description covers scoped-vs-global name qualification with concrete examples,
  because that is the thing callers actually get wrong.
- **Put next steps in the RESULT, especially on empty and error paths.**
  `"No tables found in this search group. Use \`add_code_search_table\` to add
  tables."` costs nothing until the model is stuck, and is how chains self-correct
  without bloating every description.

### 3. Adding a tool touches two files, and nothing enforces it

Registration is 86 explicit `registerXTool(server)` calls in `src/index.ts`.
There is no registry, no decorator, no codegen. Add the file under `src/tools/`
**and** the import plus call in `index.ts`, or the tool silently does not exist.

### 4. Credentials must never cross the MCP boundary

Auth is ambient: `getCredentials(alias)` reads the local store at tool-call time.
No credential is ever a tool parameter, a result field, or a log line. The
`instance` parameter is an **alias**, not a secret.

If you add a tool that surfaces configuration, surface alias names and instance
URLs only.

### 5. Route every ServiceNow call through `withConnectionRetry`

`src/common/connection.ts` caches instances per alias on a 30-minute TTL and
retries once on a stale session. A tool that constructs a `ServiceNowInstance`
directly bypasses both and will fail on an expired session where every sibling
tool recovers.

Note the retry classifier is a **message regex** — it inspects the string, not
the error type. A tool that wants a bad response retried has to throw an error
whose message the regex matches; that coupling is easy to break silently.

### 6. Test through the protocol, not around it

`test/helpers/mcp-test-helpers.ts` links a real `Client` and `McpServer` over
`InMemoryTransport.createLinkedPair()`. Assert against `client.listTools()` and
`client.callTool()` — that exercises real zod-to-JSON-Schema conversion and
SDK-side validation, which is what the model actually sees.

Testing a handler function directly skips the part most likely to be wrong.

Mocks use `jest.unstable_mockModule` plus a top-level `await import`, required
under ESM. Note `connection.ts`'s module-level cache **leaks between tests** —
existing tests only pass because each uses a distinct alias. Reusing an alias
gives you a cached instance and a `getCredentials` call count of zero.

---

## Conventions that are easy to get wrong

- No ESLint here at all — `npm run lint` is `tsc --noEmit`. Type-checking is the
  only automated gate on style.
- Every tool takes an optional `instance` param, described *for the model*
  ("the user will say things like 'on my dev instance'").
- Destructive tools are distinguished only by prose (`"IMPORTANT: This
  PERMANENTLY DELETES..."`). There are no tool annotations yet; until there are,
  the prose is the only signal a client has.
- `zod` is **v3**, not v4.

## Before you open a PR

```bash
npm run lint       # tsc --noEmit
npm run test:unit
npm run build
```

For anything model-facing, also read the tool description back and ask whether it
would be enough on its own. It has to be — nothing else reaches the caller.
