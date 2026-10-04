#!/usr/bin/env bash
# QA gate for a ServiceNow SDK or dependency bump in now-sdk-ext-mcp.
#
# Usage: scripts/sdk-watch/qa-sdk.sh [--live] [--global-sdk <version> ...]
#
# Always (no instance needed):
#   lint (tsc), build, unit tests, eval:credstore (as CI runs them), and stdio-smoke.mjs
#   --startup-only next to a simulated global now-sdk of each --global-sdk version (default:
#   latest @servicenow/sdk): the server must start with SN_CRED_STORE_ENABLE=1, keep stdout
#   pure JSON-RPC and load no telemetry. sn-credstore searches NODE_PATH, so each version is
#   installed into a temp prefix; the machine's global install and real store are untouched.
# --live   stdio-smoke.mjs against $SN_INSTANCE_ALIAS (read-only; needs SN_CRED_STORE=file with
#          that alias stored). QA_APP_SCOPE / QA_STORE_APP_SCOPE optional.
#
# Prints one JSON summary on stdout; per-step logs in $QA_ARTIFACTS (default: temp dir).
# Exit 0 only when every step passed.
set -uo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
live=false
global_sdk=()
while (($#)); do
    case "$1" in
        --live) live=true ;;
        --global-sdk) global_sdk+=("$2"); shift ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done
if $live && [[ -z "${SN_INSTANCE_ALIAS:-}" ]]; then
    echo 'set SN_INSTANCE_ALIAS (a non-production alias) for --live' >&2
    exit 2
fi
((${#global_sdk[@]})) || global_sdk=("$(npm view @servicenow/sdk dist-tags.latest)")

artifacts="${QA_ARTIFACTS:-$(mktemp -d -t mcp-qa-XXXXXX)}"
mkdir -p "$artifacts"
results="$artifacts/results.tsv"
: >"$results"
step() { # step <name> <command...>
    local name="$1"
    shift
    local log="$artifacts/$name.log" start=$SECONDS status=pass
    echo "== $name" >&2
    "$@" >"$log" 2>&1 || status=fail
    printf '%s\t%s\t%s\t%s\n' "$name" "$status" "$((SECONDS - start))" "$log" >>"$results"
    echo "   $status ($((SECONDS - start))s)" >&2
}
startup_next_to() { # startup_next_to <sdk-version>
    local prefix
    prefix="$(mktemp -d -t "global-sdk-$1-XXXXXX")"
    npm install --silent --no-audit --no-fund --prefix "$prefix" "@servicenow/sdk@$1" &&
        NODE_PATH="$prefix/node_modules" node scripts/sdk-watch/stdio-smoke.mjs --startup-only
    local status=$?
    rm -rf "$prefix"
    return $status
}

[[ -d node_modules ]] || step npm-ci npm ci
step lint npm run lint
step build npm run build
step unit npm run test:unit
step eval-credstore npm run eval:credstore
for version in "${global_sdk[@]}"; do
    step "global-sdk-$version" startup_next_to "$version"
done
if $live; then
    step live node scripts/sdk-watch/stdio-smoke.mjs
fi

node - "$results" "$artifacts" <<'EOF'
const [results, artifacts] = process.argv.slice(2);
const steps = require('node:fs').readFileSync(results, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { const [name, status, seconds, log] = l.split('\t'); return { name, status, seconds: Number(seconds), log }; });
const pass = steps.length > 0 && steps.every((s) => s.status === 'pass');
process.stdout.write(JSON.stringify({ pass, steps, artifacts }, null, 2) + '\n');
process.exit(pass ? 0 : 1);
EOF
