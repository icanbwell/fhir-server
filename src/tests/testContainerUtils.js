/**
 * Runs an async function with nock temporarily suspended.
 *
 * nock monkey-patches http.ClientRequest on import. Testcontainers talks to
 * Docker via http.request over a Unix socket — nock intercepts those calls
 * and breaks container lifecycle operations. This helper:
 *   1. Checks if nock is loaded and active
 *   2. If so, restores the original http module
 *   3. Runs the provided function
 *   4. Re-activates nock so test HTTP mocking continues to work
 *
 * Safe to call even when nock is not installed — the require is wrapped in
 * a try/catch so non-nock test environments are unaffected.
 *
 * @param {() => Promise<T>} fn - Async function to run with nock suspended
 * @returns {Promise<T>}
 * @template T
 */
async function withNockSuspended(fn) {
    // Look up nock from the module cache instead of `require('nock')`. Calling
    // require here would *load* nock if it isn't already, which has a global
    // side effect (MSW patches http.ClientRequest at import time and routes
    // every subsequent http call — including ClickHouse queries — through
    // MockHttpSocket, producing ECONNRESETs on keep-alive connections). When
    // a test file legitimately uses nock it will already be in the cache.
    let nockResolved;
    try {
        nockResolved = require.resolve('nock');
    } catch (_) {
        nockResolved = null;
    }
    const nockModule = nockResolved ? require.cache[nockResolved]?.exports : null;

    let nockWasActive = false;
    if (nockModule && nockModule.isActive()) {
        nockWasActive = true;
        nockModule.restore();
    }

    try {
        return await fn();
    } finally {
        if (nockWasActive) {
            nockModule.activate();
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
