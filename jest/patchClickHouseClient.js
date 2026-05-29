// Patches @clickhouse/client.createClient so every ClickHouse client constructed
// during tests has keep-alive disabled and internal logging silenced — without
// leaking these test concerns into production code.
//
// Why keep-alive must be off: nock v14 wraps every http.ClientRequest in a
// MockHttpSocket; an idle keep-alive socket left over from a prior test file
// can fire 'read EINVAL' as the next test file loads and abort the suite.
//
// Why log level OFF: the ClickHouse client has its own logger that writes
// directly to stdout/stderr; Winston's LOGLEVEL=SILENT does not silence it.
//
// Loaded via jest.config.js `setupFiles` (per-worker) and required from
// jestGlobalSetup.js (parent process) so both contexts are covered.
const clickhouseModule = require('@clickhouse/client');

const original = clickhouseModule.createClient;

Object.defineProperty(clickhouseModule, 'createClient', {
    value: (options = {}) =>
        original({
            ...options,
            keep_alive: { ...(options.keep_alive || {}), enabled: false },
            log: { ...(options.log || {}), level: clickhouseModule.ClickHouseLogLevel.OFF }
        }),
    writable: true,
    configurable: true
});
