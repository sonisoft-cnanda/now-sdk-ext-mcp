#!/usr/bin/env node
// Check and bump this repo's ServiceNow SDK pins and @sonisoft dependencies.
// The same script lives in now-sdk-ext-core, -cli and -mcp; only CONFIG differs.
//
// Usage:
//   node scripts/sdk-watch/sdk-deps.mjs check
//   node scripts/sdk-watch/sdk-deps.mjs bump [--sdk <version|candidate>] [--credstore <version|latest>]
//                                            [--core <version|latest>] [--no-install] [--force]
//
// check  never changes anything. JSON `actions` lists what is due; `next` gives commands.
// bump   edits package.json (keeping each dependency's pin style), then `npm install`
//        so package-lock.json follows. Refuses an SDK version the sn-credstore release this
//        repo will ship does not allowlist (its shim would fail closed), unless --force.
//
// Progress goes to stderr; the result is one JSON document on stdout. Exit 1 on error.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- per-repo configuration -------------------------------------------------------------
const CONFIG = {
    // Released in lockstep with one version number; pinned exactly and moved together.
    sdkPackages: ['@servicenow/sdk', '@servicenow/sdk-cli', '@servicenow/sdk-core', '@servicenow/sdk-build-core'],
    // On their own release line: reported, never moved by --sdk.
    independent: ['@servicenow/sdk-cli-core'],
    // Our packages and how this repo pins them ('caret' => ^x.y.z, 'exact' => x.y.z).
    // sn-credstore is pinned exactly here, deliberately; keep it that way.
    internal: { '@sonisoft/now-sdk-ext-core': 'caret', '@sonisoft/sn-credstore': 'exact' },
};
// -----------------------------------------------------------------------------------------

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const log = (m) => process.stderr.write(`${m}\n`);
const emit = (result, code = 0) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(code);
};
const isRelease = (v) => /^\d+\.\d+\.\d+$/.test(v);
const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
};
const floorOf = (spec) => spec?.replace(/^[\^~=]/, '');
/** `npm view`; undefined when the package or version does not exist. */
function npmView(spec, field) {
    try {
        const out = execFileSync('npm', ['view', spec, field, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        return out ? JSON.parse(out) : undefined;
    } catch (err) {
        if (/E404/.test(String(err.stderr ?? err.message))) return undefined;
        throw err;
    }
}
/** KNOWN_GOOD_VERSIONS of a published sn-credstore release, read from its tarball. */
function credstoreAllowlist(version) {
    const dir = mkdtempSync(join(tmpdir(), 'credstore-allowlist-'));
    try {
        const [packed] = JSON.parse(execFileSync('npm', ['pack', `@sonisoft/sn-credstore@${version}`, '--json', '--pack-destination', dir],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        mkdirSync(join(dir, 'x'));
        execFileSync('tar', ['xzf', join(dir, packed.filename), '-C', join(dir, 'x')]);
        const source = readFileSync(join(dir, 'x/package/dist/esm/shim/locateSdkCli.js'), 'utf8');
        const match = source.match(/KNOWN_GOOD_VERSIONS = new Set\(\[([^\]]*)\]\)/);
        // An empty list would read as "nothing is allowlisted" and quietly block every bump.
        if (!match) throw new Error(`cannot read KNOWN_GOOD_VERSIONS from @sonisoft/sn-credstore@${version}; its build layout changed, update credstoreAllowlist()`);
        return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const SECTIONS = ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies'];
const declared = (name) => {
    for (const s of SECTIONS) if (pkg[s]?.[name]) return { section: s, spec: pkg[s][name] };
    return null;
};
const locked = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? null;

function check() {
    const sdkDeclared = CONFIG.sdkPackages.map((n) => ({ name: n, ...declared(n) })).filter((d) => d.spec);
    const pins = [...new Set(sdkDeclared.map((d) => floorOf(d.spec)))];
    const pinned = pins.length === 1 ? pins[0] : null;
    const published = (npmView('@servicenow/sdk-cli', 'versions') ?? []).filter(isRelease).sort(cmp);
    const latestSdk = npmView('@servicenow/sdk-cli', 'dist-tags')?.latest ?? null;

    const credstoreLatest = npmView('@sonisoft/sn-credstore', 'dist-tags')?.latest ?? null;
    const allowed = credstoreLatest ? credstoreAllowlist(credstoreLatest) : [];
    const newer = pinned ? published.filter((v) => cmp(v, pinned) > 0) : [];
    const candidate = newer.filter((v) => allowed.includes(v)).at(-1) ?? null;
    // Only releases past sn-credstore's newest allowlisted one are waiting on it; older
    // unlisted ones (4.9.1, 4.10.0) were skipped on purpose and never become candidates.
    const newestAllowed = [...allowed].sort(cmp).at(-1);
    const blocked = newer.filter((v) => !allowed.includes(v) && newestAllowed && cmp(v, newestAllowed) > 0);

    const internal = Object.entries(CONFIG.internal).map(([name, style]) => {
        const d = declared(name);
        const latest = npmView(name, 'dist-tags')?.latest ?? null;
        const floor = floorOf(d?.spec);
        return {
            name, style, declared: d?.spec ?? null, section: d?.section ?? null, locked: locked(name), latest,
            floorBehind: Boolean(floor && latest && cmp(floor, latest) < 0),
            lockBehind: Boolean(locked(name) && latest && cmp(locked(name), latest) < 0),
        };
    });
    // Newest published rather than the `latest` tag, which lags on some of these
    // (sdk-cli-core 3.0.3 is published while `latest` still says 3.0.2).
    const independent = CONFIG.independent.map((name) => ({
        name, declared: declared(name)?.spec ?? null,
        newestPublished: (npmView(name, 'versions') ?? []).filter(isRelease).sort(cmp).at(-1) ?? null,
    }));

    const actions = [];
    const next = [];
    if (!pinned) actions.push(`fix-mixed-sdk-pins: ${sdkDeclared.map((d) => `${d.name}@${d.spec}`).join(', ')}`);
    for (const i of internal.filter((x) => x.floorBehind || x.lockBehind)) {
        actions.push(`bump-internal:${i.name}@${i.latest}`);
        next.push(`node scripts/sdk-watch/sdk-deps.mjs bump --${i.name === '@sonisoft/sn-credstore' ? 'credstore' : 'core'} ${i.latest}`);
    }
    if (candidate) {
        actions.push(`bump-sdk:${candidate}`);
        next.push(`node scripts/sdk-watch/sdk-deps.mjs bump --sdk ${candidate}`);
    }
    if (blocked.length) actions.push(`wait-for-credstore:${blocked.join(',')}`);

    const result = {
        repo: pkg.name,
        sdk: {
            pinned, packages: sdkDeclared.map((d) => `${d.name}@${d.spec}`), npmLatest: latestSdk,
            newerPublished: newer, credstoreLatest, allowedByCredstoreLatest: allowed,
            candidate, blockedByCredstore: blocked,
        },
        independent,
        internal,
        actions,
        next,
    };
    log(`${pkg.name}: SDK ${pinned ?? 'mixed'} (npm ${latestSdk}); actions: ${actions.join('; ') || 'none'}`);
    return result;
}

function bump(args) {
    // Every flag takes a value: a release (x.y.z) or the keyword it names.
    const opt = (n, keyword) => {
        const i = args.indexOf(n);
        if (i < 0) return undefined;
        const v = args[i + 1];
        if (!v || (v !== keyword && !isRelease(v))) throw new Error(`${n} needs a version (x.y.z) or "${keyword}", got ${v ?? 'nothing'}`);
        return v;
    };
    const changes = [];
    const set = (name, value) => {
        const d = declared(name);
        if (!d) return;
        if (d.spec !== value) changes.push({ name, from: d.spec, to: value });
        pkg[d.section][name] = value;
    };
    const resolveLatest = (name, v) => (v === 'latest' ? npmView(name, 'dist-tags')?.latest : v);
    const style = (name, v) => (CONFIG.internal[name] === 'exact' ? v : `^${v}`);

    const credstoreArg = opt('--credstore', 'latest');
    const credstore = credstoreArg && resolveLatest('@sonisoft/sn-credstore', credstoreArg);
    if (credstore) set('@sonisoft/sn-credstore', style('@sonisoft/sn-credstore', credstore));
    const coreArg = opt('--core', 'latest');
    const core = coreArg && resolveLatest('@sonisoft/now-sdk-ext-core', coreArg);
    if (core) set('@sonisoft/now-sdk-ext-core', style('@sonisoft/now-sdk-ext-core', core));

    let sdk = opt('--sdk', 'candidate');
    if (sdk === 'candidate') sdk = check().sdk.candidate;
    if (opt('--sdk', 'candidate') && !sdk) emit({ ok: false, error: 'no SDK candidate: nothing newer is allowlisted by sn-credstore yet' }, 1);
    if (sdk) {
        for (const name of CONFIG.sdkPackages) {
            if (declared(name) && npmView(`${name}@${sdk}`, 'version') !== sdk) emit({ ok: false, error: `${name}@${sdk} is not published` }, 1);
        }
        // The sn-credstore this repo will resolve must allowlist the new SDK.
        const credstoreFor = floorOf(declared('@sonisoft/sn-credstore')?.spec) ?? null;
        const shipped = credstoreFor && (CONFIG.internal['@sonisoft/sn-credstore'] === 'exact'
            ? credstoreFor : npmView('@sonisoft/sn-credstore', 'dist-tags')?.latest);
        if (shipped && !credstoreAllowlist(shipped).includes(sdk) && !args.includes('--force')) {
            emit({ ok: false, error: `@sonisoft/sn-credstore ${shipped} does not allowlist SDK ${sdk}; allowlist it there first` }, 1);
        }
        for (const name of CONFIG.sdkPackages) set(name, sdk);
    }
    if (!changes.length) emit({ ok: true, changes, note: 'nothing to change' });

    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    if (!args.includes('--no-install')) {
        log('npm install ...');
        // npm's own output to stderr: stdout carries only this script's JSON result.
        execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: ['ignore', 2, 2] });
    }
    const after = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    emit({
        ok: true,
        changes,
        lockedNow: Object.fromEntries(changes.map((c) => [c.name, after.packages?.[`node_modules/${c.name}`]?.version ?? null])),
        next: ['scripts/sdk-watch/qa-sdk.sh', 'commit as: fix(deps): …'],
    });
}

const [command, ...rest] = process.argv.slice(2);
try {
    if (command === 'check') emit(check());
    else if (command === 'bump') bump(rest);
    else {
        log('usage: sdk-deps.mjs check | bump [--sdk <v|candidate>] [--credstore <v|latest>] [--core <v|latest>] [--no-install] [--force]');
        process.exit(2);
    }
} catch (err) {
    emit({ ok: false, error: err.message }, 1);
}
