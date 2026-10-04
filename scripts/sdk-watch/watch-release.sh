#!/usr/bin/env bash
# Follow a merge to main through semantic-release, the npm publish, and npm propagation.
# The same script lives in sn-credstore, now-sdk-ext-core, -cli and -mcp.
#
# Usage: scripts/sdk-watch/watch-release.sh <merge-commit-sha>
#
# Release chain in these repos: push to main -> release.yml (semantic-release cuts the version,
# tag and GitHub release) -> that release fires publish.yml (npm publish via OIDC).
# Checks the publish step really published ("+ <pkg>@<version>"), not just that the job was
# green: it skips when the version already exists. npm can take a few minutes to serve a new
# version (1.5-3.5 min observed), so this polls for up to 20.
#
# Prints one JSON document on stdout. Exit 0 when the version is visible on npm;
# exit 3 when the merge produced no release (e.g. only chore/docs/test commits).
set -uo pipefail
sha="${1:?usage: watch-release.sh <merge-commit-sha>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
repo="$(cd "$root" && gh repo view --json nameWithOwner --jq .nameWithOwner)"
pkg="$(node -p "require('$root/package.json').name")"
result() { # result <stage> <true|false> <detail> <exit-code>: serialised by node, so any text is safe
    node -e 'const [repo, pkg, sha, stage, ok, detail] = process.argv.slice(1);
        process.stdout.write(JSON.stringify({ repo, package: pkg, sha, stage, ok: ok === "true", detail }) + "\n");' \
        "$repo" "$pkg" "$sha" "$1" "$2" "$3"
    exit "$4"
}

rid=""
for _ in $(seq 1 30); do
    rid="$(gh run list -R "$repo" --workflow=release.yml --commit "$sha" --json databaseId --jq '.[0].databaseId')"
    [[ -n "$rid" ]] && break
    sleep 10
done
[[ -n "$rid" ]] || result release-run false "no release.yml run for $sha" 1
echo "release run $rid" >&2
gh run watch "$rid" -R "$repo" --interval 15 --exit-status >/dev/null 2>&1
conclusion="$(gh run view "$rid" -R "$repo" --json conclusion --jq .conclusion)"
[[ "$conclusion" == success ]] || result release false "release run $rid concluded $conclusion" 1
release_log="$(mktemp)"
gh run view "$rid" -R "$repo" --log >"$release_log" 2>/dev/null
version="$(grep -oE 'Published release [0-9]+\.[0-9]+\.[0-9]+' "$release_log" | awk 'NR == 1 {print $3}')"
rm -f "$release_log"
[[ -n "$version" ]] || result release true "run $rid succeeded without cutting a release (no fix/feat commits)" 3
echo "released $version" >&2

# publish.yml runs are titled after the release tag ("v<version>", semantic-release's default
# tagFormat); match on that. A changed tagFormat needs this select changed too.
pid=""
for _ in $(seq 1 30); do
    pid="$(gh run list -R "$repo" --workflow=publish.yml --limit 10 --json databaseId,displayTitle \
        --jq ".[] | select(.displayTitle == \"v$version\") | .databaseId" | head -1)"
    [[ -n "$pid" ]] && break
    sleep 10
done
[[ -n "$pid" ]] || result publish-run false "no publish.yml run for v$version (is RELEASE_TOKEN set?)" 1
echo "publish run $pid" >&2
gh run watch "$pid" -R "$repo" --interval 15 --exit-status >/dev/null 2>&1
[[ "$(gh run view "$pid" -R "$repo" --json conclusion --jq .conclusion)" == success ]] || result publish false "publish run $pid failed" 1
# Saved first: `grep -q` stops reading at the first match, and under pipefail the writer's
# resulting SIGPIPE would turn a found line into a failure.
publish_log="$(mktemp)"
gh run view "$pid" -R "$repo" --log >"$publish_log" 2>/dev/null
grep -qF "+ $pkg@$version" "$publish_log" \
    || { rm -f "$publish_log"; result publish false "publish run $pid did not publish $pkg@$version (skipped or dry run?)" 1; }
rm -f "$publish_log"

for i in $(seq 1 40); do
    if [[ "$(npm view "$pkg@$version" version 2>/dev/null)" == "$version" ]]; then
        result npm true "$pkg@$version visible on npm after ~$((i * 30))s; latest=$(npm view "$pkg" dist-tags.latest)" 0
    fi
    sleep 30
done
result npm false "$pkg@$version published but not visible on npm after 20 min" 1
