import { getCredentials } from "@servicenow/sdk-cli/dist/auth/index.js";
import {
  ServiceNowInstance,
  ServiceNowSettingsInstance,
} from "@sonisoft/now-sdk-ext-core";
import { getLogger } from "./logging.js";

const log = getLogger("connection");

/** Cached instance with creation timestamp for TTL expiry. */
interface CacheEntry {
  instance: ServiceNowInstance;
  createdAt: number;
}

/** Cache TTL — 30 minutes. ServiceNow sessions typically expire after idle time. */
const CACHE_TTL_MS = 30 * 60 * 1000;

const instanceCache = new Map<string, CacheEntry>();

/**
 * Resolves the auth alias from the explicit parameter or the SN_AUTH_ALIAS env var.
 * Throws if neither is available.
 */
function resolveAlias(authAlias?: string): string {
  const resolved = authAlias || process.env.SN_AUTH_ALIAS;
  if (!resolved) {
    throw new Error(
      "No instance specified. Either pass an instance alias " +
        '(e.g., "on my myinstance instance") or set the SN_AUTH_ALIAS environment variable.'
    );
  }
  return resolved;
}

/**
 * Returns a ServiceNowInstance using stored credentials from the ServiceNow
 * CLI credential store (snc configure).
 *
 * Resolution order: explicit authAlias parameter → SN_AUTH_ALIAS env var.
 * Throws if neither is available.
 *
 * Instances are cached per alias with a 30-minute TTL so that repeated
 * calls reuse the same session, but stale sessions are automatically
 * refreshed. This allows the AI to work with multiple instances in a
 * single conversation (e.g., myinstance and prod).
 */
export async function getServiceNowInstance(
  authAlias?: string
): Promise<ServiceNowInstance> {
  const resolvedAlias = resolveAlias(authAlias);

  const cached = instanceCache.get(resolvedAlias);
  if (cached) {
    const age = Date.now() - cached.createdAt;
    if (age < CACHE_TTL_MS) {
      return cached.instance;
    }
    // TTL expired — evict and create fresh
    log.debug("Cache TTL expired, refreshing session", { alias: resolvedAlias });
    instanceCache.delete(resolvedAlias);
  }

  const credential = await getCredentials(resolvedAlias);
  if (!credential) {
    // The previous text told users to run "snc configure", which is not a
    // command this SDK has ever shipped — so the one actionable line in the
    // error sent them nowhere.
    //
    // Distinguish the two causes, because from here they look identical: with
    // the shim inactive, a null credential usually means the keyring could not
    // be unlocked (KeyChain.getPassword() swallows that and returns null)
    // rather than that the alias is missing. An MCP server is always launched
    // non-interactively, so that is the likelier of the two.
    const shimActive = process.env.NOW_SDK_KEYCHAIN_PATCHED === "1";
    throw new Error(
      `No credentials found for auth alias "${resolvedAlias}". ` +
        (shimActive
          ? `Run "nex auth list" to see stored aliases, or ` +
            `"now-sdk-x auth --add <instance>" to add one.`
          : `The headless credential store is not active, so the SDK is reading ` +
            `the OS keyring, which this process cannot unlock. Check that ` +
            `SN_CRED_STORE_DISABLE is unset, then run "nex auth doctor".`)
    );
  }

  const snSettings: ServiceNowSettingsInstance = {
    alias: resolvedAlias,
    credential,
  };

  const instance = new ServiceNowInstance(snSettings);
  instanceCache.set(resolvedAlias, {
    instance,
    createdAt: Date.now(),
  });
  return instance;
}

/**
 * Evicts a cached instance so the next call to getServiceNowInstance()
 * creates a fresh connection.
 */
export function clearInstance(authAlias?: string): void {
  const resolved = authAlias || process.env.SN_AUTH_ALIAS;
  if (resolved) {
    instanceCache.delete(resolved);
  }
}

/** Patterns that indicate a connection/session problem worth retrying. */
/** Set by sn-credstore's shim once it has taken over credential storage. */
export const CRED_STORE_PATCHED_ENV = "NOW_SDK_KEYCHAIN_PATCHED";

/**
 * True when credentials come from sn-credstore rather than the OS keyring.
 *
 * Exported so callers do not re-spell the variable name and the "=== 1"
 * convention; both were already duplicated once.
 */
export function isCredStoreActive(): boolean {
  return process.env[CRED_STORE_PATCHED_ENV] === "1";
}

const RETRYABLE_PATTERNS =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|No response|Body not XML/i;

/**
 * Returns true if the error looks like a transient connection or stale-session
 * problem that could be fixed by creating a fresh ServiceNowInstance.
 */
function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return RETRYABLE_PATTERNS.test(msg);
}

/**
 * Returns true if an HTTP response indicates a stale or dead session.
 */
export function isRetryableResponse(
  response: { status?: number; statusText?: string } | null | undefined
): boolean {
  if (!response || response.status == null) return true; // no response at all
  if (response.status === 401) return true; // session expired
  return false;
}

/**
 * Executes an operation against a ServiceNow instance with automatic retry.
 *
 * On the first attempt, uses the (possibly cached) instance. If the operation
 * throws a retryable error, the cached instance is evicted and the operation
 * is retried once with a fresh connection.
 *
 * Usage:
 * ```ts
 * return withConnectionRetry(instance, async (snInstance) => {
 *   // ... use snInstance ...
 * });
 * ```
 */
export async function withConnectionRetry<T>(
  authAlias: string | undefined,
  operation: (instance: ServiceNowInstance) => Promise<T>
): Promise<T> {
  const snInstance = await getServiceNowInstance(authAlias);
  try {
    return await operation(snInstance);
  } catch (error) {
    if (isRetryableError(error)) {
      // The error went into the message before, unredacted — an auth or HTTP failure
      // here carries a live session. As metadata it goes through redaction.
      log.warn("Retryable error, refreshing session and retrying", { error });
      clearInstance(authAlias);
      const freshInstance = await getServiceNowInstance(authAlias);
      return await operation(freshInstance);
    }
    throw error;
  }
}
