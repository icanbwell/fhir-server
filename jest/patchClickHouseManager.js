// Wraps every network-touching ClickHouseClientManager method so it runs with
// nock suspended — without leaking this test concern into production code.
//
// Why: nock v14 (built on @mswjs/interceptors) wraps every http.ClientRequest in
// a MockHttpSocket while active. ClickHouse queries are not mocked, so they are
// "passed through" — but the passthrough MockHttpSocket shares the real socket's
// underlying _handle. On connection teardown the shared fd can be closed under
// one socket while the other still reads it, surfacing as intermittent
// `read EINVAL` failures that randomly abort ClickHouse tests in CI. Disabling
// keep-alive (patchClickHouseClient.js) removed idle-socket leaks but not the
// passthrough race itself.
//
// The manager methods are the right boundary: each performs the full request AND
// reads the response body (resultSet.json()) before returning, so suspending
// around the method keeps the entire socket lifecycle on real, un-intercepted
// sockets. tableExistsAsync / truncateTableAsync delegate to queryAsync, so they
// are covered transitively. withNockSuspended is reference counted, so nested
// (tableExists -> query) and concurrent (parallel inserts) calls keep nock
// suspended until the last one completes.
//
// Loaded via jest.config.js `setupFiles` (per-worker) and required from
// jestGlobalSetup.js (parent process, which runs the schema-wait probe) so both
// contexts are covered.
const { ClickHouseClientManager } = require('../src/utils/clickHouseClientManager');
const { withNockSuspended } = require('../src/tests/testContainerUtils');

const NETWORK_METHODS = ['queryAsync', 'insertAsync', 'pingAsync', 'executeBatchAsync', 'closeAsync'];

for (const name of NETWORK_METHODS) {
    const original = ClickHouseClientManager.prototype[name];
    if (typeof original !== 'function' || original.__nockSuspendWrapped) {
        continue;
    }
    function wrapped(...args) {
        return withNockSuspended(() => original.apply(this, args));
    }
    wrapped.__nockSuspendWrapped = true;
    ClickHouseClientManager.prototype[name] = wrapped;
}
