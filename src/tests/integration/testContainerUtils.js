/**
 * Reference count of in-flight {@link withNockSuspended} calls. nock is restored
 * when this goes 0 -> 1 and re-activated when it returns to 0, so concurrent or
 * nested suspensions never re-activate nock while another caller still needs it
 * suspended.
 * @type {number}
 */
let nockSuspendDepth = 0;

/**
 * The nock module that was active (and therefore restored) at the outermost
 * suspension. Held so the matching re-activation targets the same instance.
 * @type {*}
 */
let suspendedNockModule = null;

/**
 * Resolves the nock module from the require cache without loading it.
 *
 * Calling `require('nock')` here would *load* nock if it isn't already, which
 * has a global side effect: nock (v14, built on @mswjs/interceptors) patches
 * http.ClientRequest at import time and routes every subsequent http call
 * through MockHttpSocket. When a test file legitimately uses nock it will
 * already be in the cache.
 *
 * @returns {*} the cached nock module, or null if not loaded
 */
function resolveCachedNock() {
    let nockResolved;
    try {
        nockResolved = require.resolve('nock');
    } catch (_) {
        nockResolved = null;
    }
    return nockResolved ? require.cache[nockResolved]?.exports : null;
}

/**
 * Runs an async function with nock temporarily suspended.
 *
 * nock (v14) delegates to @mswjs/interceptors, which wraps every outbound
 * http.ClientRequest in a MockHttpSocket on import. Two places this breaks
 * real network I/O during tests:
 *   1. Testcontainers talks to Docker via http over a Unix socket — nock
 *      intercepts those calls and breaks container lifecycle operations.
 *   2. ClickHouse queries go over HTTP to a host nock does not mock. nock
 *      "passes through" such requests, but the passthrough MockHttpSocket
 *      shares the real socket's underlying _handle; on connection teardown the
 *      shared fd can be closed under one socket while the other still reads it,
 *      surfacing as intermittent `read EINVAL` / ECONNRESET failures in CI.
 *
 * This helper restores the original http module for the duration of `fn` so the
 * wrapped code uses real, un-intercepted sockets, then re-activates nock so test
 * HTTP mocking continues to work. Suspension is reference counted, so it is safe
 * to nest and to run concurrently (ClickHouse can issue parallel queries).
 *
 * Safe to call even when nock is not installed — the lookup is cache-only so
 * non-nock test environments are unaffected.
 *
 * @param {() => Promise<T>} fn - Async function to run with nock suspended
 * @returns {Promise<T>}
 * @template T
 */
async function withNockSuspended(fn) {
    if (nockSuspendDepth === 0) {
        const nockModule = resolveCachedNock();
        if (nockModule && nockModule.isActive()) {
            suspendedNockModule = nockModule;
            nockModule.restore();
        } else {
            suspendedNockModule = null;
        }
    }
    nockSuspendDepth++;

    try {
        return await fn();
    } finally {
        nockSuspendDepth--;
        if (nockSuspendDepth === 0 && suspendedNockModule) {
            suspendedNockModule.activate();
            suspendedNockModule = null;
        }
    }
}

/**
 * Sets environment variables and returns their previous values for later restore.
 *
 * @param {Record<string, string>} vars - Key/value pairs to set on process.env
 * @returns {Record<string, string|undefined>} Previous values (undefined if the key didn't exist)
 *
 * @example
 *   const saved = setEnvVars({ REDIS_HOST: container.getHost(), REDIS_PORT: '32786' });
 *   // ... use Redis ...
 *   restoreEnvVars(saved);
 */
function setEnvVars(vars) {
    const saved = {};
    for (const [key, value] of Object.entries(vars)) {
        saved[key] = process.env[key];
        process.env[key] = String(value);
    }
    return saved;
}

/**
 * Restores environment variables to their previous values.
 * Keys that were previously undefined are deleted from process.env.
 *
 * @param {Record<string, string|undefined>} saved - Object returned by setEnvVars()
 */
function restoreEnvVars(saved) {
    for (const [key, value] of Object.entries(saved)) {
        if (value !== undefined) {
            process.env[key] = value;
        } else {
            delete process.env[key];
        }
    }
}

module.exports = {
    withNockSuspended,
    setEnvVars,
    restoreEnvVars
};
