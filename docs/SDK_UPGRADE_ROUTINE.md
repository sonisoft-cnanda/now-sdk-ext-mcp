# ServiceNow SDK upgrade routine

Runbook for a scheduled agent routine that notices new `@servicenow/sdk` releases, has them
QA'd, and rolls them through our four packages when QA passes. The same overview opens this
document in every repo; the second half is specific to this repo.

## Why there is a chain at all

`@sonisoft/sn-credstore` patches the SDK's credential storage. It **fails closed** on any
`@servicenow/sdk-cli` release it has not reviewed, and it checks every copy it can find,
including the one behind a globally installed `now-sdk`. So when someone runs
`npm i -g @servicenow/sdk` and gets a new release, every `--cred-store` consumer on that
machine stops working (`… has not been verified against this shim`) until sn-credstore
allowlists that release and the consumers pick up the new sn-credstore. Nothing is broken
in our code; the shim is refusing an unreviewed release on purpose. The routine's job is to
make that window short.

```
@servicenow/sdk X.Y.Z on npm
  1. sn-credstore         detect -> review seams -> allowlist -> QA -> PR -> merge -> npm   (feat:)
  2. now-sdk-ext-core     raise sn-credstore floor (+ optionally SDK pins) -> QA -> PR -> npm (fix(deps):)
  3. now-sdk-ext-cli  }   bump core / sn-credstore (+ optionally SDK pins) -> QA -> PR -> npm (fix(deps):)
     now-sdk-ext-mcp  }   (separate repos: may run in parallel)
  4. hosts                reinstall global `nex`; MCP clients restart/reinstall
```

Each step starts only after the previous package is **visible on npm** (`watch-release.sh`).

## Roles

| Role | Does | Never |
|---|---|---|
| Engineer agent | runs the check/review/bump scripts, edits, opens PRs, answers review notes, merges after QA passes, watches the release | merges with failing QA or CI; allowlists past a `seams-changed` verdict |
| QA agent | `gh pr checkout <n>`, runs this repo's QA script, posts the JSON summary on the PR, approves or rejects | edits code; runs live checks against production |

## Rules for every repo

- **Production is off limits.** Live checks need `SN_INSTANCE_ALIAS` set to a PDI/dev alias.
  They only read and run `gs.info()` scripts, except core's `--integration`, which creates and
  deletes test records.
- **Never print or commit a secret.** Use `SN_CRED_STORE=file` for live checks. Every QA script
  uses throwaway stores for anything it writes.
- **One merge at a time per repo.** `release.yml` has no concurrency guard. Merge, run
  `watch-release.sh <merge-sha>`, and only then merge the next PR in that repo.
- **PR titles are conventional commits.** `main` only allows squash merges, and the squash
  commit takes the PR title, which semantic-release reads: `feat:` is a minor release,
  `fix:`/`fix(deps):` a patch, and `chore:`/`docs:`/`test:` no release.
- **Stop and escalate to a human** on any of these:
  - a sn-credstore review verdict of `seams-changed` or `error`
  - QA that fails twice for the same reason
  - a blocking review comment you cannot resolve
  - a `watch-release.sh` failure at the `publish` stage

## Script conventions

All scripts live in `scripts/sdk-watch/`.
- Progress goes to **stderr**, and the result is **one JSON document on stdout**.
- `check` scripts exit 0 and describe what is due in `action`/`actions` plus `next` (exact
  commands to run). QA scripts exit 0 only when every step passed. Exit 2 means bad usage.

Host prerequisites:
- Node >= 26, npm, `tar`, `diff`, `gh` (authenticated with push access to the four repos)
- `keyctl` (package `keyutils`) for sn-credstore's headless ladder
- network access to npm
- for live checks only: `SN_CRED_STORE=file` with the alias stored in the sn-credstore file
  store, and `SN_INSTANCE_ALIAS`
- optional: `QA_APP_SCOPE` (a `sys_app` scope on that instance) and `QA_STORE_APP_SCOPE` (a
  `sys_store_app` scope), so the live checks also cover both kinds of app

## Pitfalls we have already hit

- **Green is not published.** A publish job also succeeds when it *skips* an existing version.
  `watch-release.sh` checks the log for `+ <pkg>@<version>`.
- **npm lags.** A new version took 1.5–3.5 minutes to appear. Poll rather than fail.
- **The automated `claude-review` check can fail on its own.** If it fails with
  `Claude execution failed: result is_error:true`, the run crashed rather than reviewed:
  `gh run rerun <run-id> --failed`. Notes it leaves on a passing run are non-blocking unless
  it says otherwise.
- **The SDK logger writes to stdout.** Lines like `[now-sdk] Access Token has expired,
  refreshing token` go to stdout by default. Our scripts redirect them. This corrupts an MCP
  server's JSON-RPC stream, which `stdio-smoke.mjs` checks for.
- **A global `now-sdk` changes behaviour.** QA simulates a global SDK of a given version
  through `NODE_PATH` (sn-credstore searches it) instead of touching the real global install.
- **SDK packages move in lockstep.** `sdk`, `sdk-cli`, `sdk-core`, `sdk-build-core` and
  `sdk-api` share one version. `@servicenow/sdk-cli-core` has its own line, and its `latest`
  tag can lag.
- **Global is only identifiable by its sys_id.** In `sys_scope`, `scope=global` matches every
  global-scoped app. `source=global` also matches apps that now-sdk deployed into global (two on
  one PDI). Script output (`Script completed in scope global`, `rhino.global`) looks identical
  for Global and for those apps, so the live checks assert the sys_id actually sent (`global`).
- **Telemetry.** SDK 4.12+ ships `posthog-node` under `sdk-build-core`. Nothing in our runtime
  loads it, and `NO_TELEMETRY=1` disables it; the MCP stdio smoke asserts it stays unloaded.

---

## This repo: now-sdk-ext-mcp (step 3)

The MCP server depends on core (`^`) and pins **both** sn-credstore and the SDK packages
exactly. Keep those pins exact. An MCP client launches the server as a headless child
process, which is exactly where `SN_CRED_STORE_ENABLE=1` is needed. So a stale sn-credstore
pin here means the server exits at startup next to a newer global `now-sdk`. That happened
with 1.1.1 against SDK 4.13.

stdout is the JSON-RPC transport. Any stray line there breaks the client's stream.

| Script | Who | Purpose |
|---|---|---|
| `sdk-deps.mjs check` | engineer | SDK pins vs npm and vs the latest sn-credstore allowlist; core / sn-credstore declared, locked and latest. `actions` + `next`. |
| `sdk-deps.mjs bump [--core <v\|latest>] [--credstore <v\|latest>] [--sdk <v\|candidate>]` | engineer | Edits `package.json` (exact sn-credstore pin kept exact), runs `npm install`. |
| `qa-sdk.sh [--live] [--global-sdk <v> ...]` | QA | `tsc`, build, unit, `eval:credstore`, and a stdio startup check next to a simulated global `now-sdk`; `--live` adds the full `stdio-smoke.mjs`. |
| `stdio-smoke.mjs [--startup-only]` | QA | Real stdio session: handshake, `tools/list`, `query_table`, `execute_script` (global / unknown scope / optional store app and `sys_app`). It also checks that **stdout stays pure JSON-RPC** and that **no telemetry module loads**. |
| `watch-release.sh <merge-sha>` | engineer | release run → version → real publish → visible on npm. |

### Engineer steps

1. After core (and sn-credstore) are on npm:
   ```bash
   git switch main && git pull && npm ci
   node scripts/sdk-watch/sdk-deps.mjs check
   ```
2. On a branch:
   ```bash
   node scripts/sdk-watch/sdk-deps.mjs bump --core latest --credstore latest
   ```
   When core's SDK version moved, expect `package-lock.json` to grow: npm nests core's SDK tree
   while this repo pins a different SDK. Aligning the SDK pins (`--sdk <core's pin>`) removes
   that; see [issue #23](https://github.com/sonisoft-cnanda/now-sdk-ext-mcp/issues/23).
3. PR `fix(deps): use now-sdk-ext-core <v> and sn-credstore <v>`. QA runs `qa-sdk.sh --live`.
4. Squash-merge, then `scripts/sdk-watch/watch-release.sh <merge-sha>`. MCP clients pick up the
   new version on their next start (npx) or after a reinstall.

### QA steps

```bash
gh pr checkout <n> && npm ci
SN_CRED_STORE=file SN_INSTANCE_ALIAS=<pdi-alias> \
  QA_APP_SCOPE=<sys_app scope> QA_STORE_APP_SCOPE=<store app scope> \
  scripts/sdk-watch/qa-sdk.sh --live --global-sdk <new-sdk-version>
```
Run the live session **without** `NEX_POLICY_DENY` restricting `execute` or `write`. The
server's permission guard classes `execute_script` as both, since it can run any script, so a
deny turns the scope checks into refusals that look like regressions. The smoke test itself only
runs `gs.info()`.

The `stdout carries only JSON-RPC` check only exercises the token-refresh path when the
alias's access token has expired at the time of the run. For a full check, run it once with an
expired token: they last about 30 minutes, so check the expiry with
`sn-credstore list --json`. It runs in about 1 minute.
