// Keeps a late passthrough-socket `read EINVAL` from aborting whichever suite
// happens to be running — without leaking this test concern into production code.
//
// Why: nock v14 (built on @mswjs/interceptors) wraps every http.ClientRequest in
// a MockHttpSocket while active, including un-mocked "passthrough" traffic such
// as supertest calls to the in-process server. The passthrough MockHttpSocket
// shares the real socket's underlying _handle and re-emits the real socket's
// 'error' events on itself (MockHttpSocket.ts passthrough handlers). Under socket
// churn the shared fd intermittently reads as invalid; when the resulting
// EINVAL reaches an emitter with no 'error' listener (the MockHttpSocket after
// its request detached, or a ClientRequest that never attached one) it becomes
// an uncaught exception and Jest reports "Test suite failed to run" for an
// unrelated suite. Which suite is hit depends on shard composition, so adding
// or removing any test file can surface it. patchClickHouseManager.js and
// groupTestSetup.js suspend nock for specific traffic; this covers the rest.
//
// Only EINVAL is absorbed: it is the signature of the shared-fd race, not an
// outcome any test asserts on. Every other socket error (ECONNREFUSED,
// ECONNRESET, timeouts) still reaches the request exactly as before. A one-line
// note goes to stderr (which --silent does not suppress) so occurrences stay
// visible.
//
// Loaded via jest.config.js `setupFiles`. http is a core module shared across
// every test file in the process, so the patch is guarded to apply once.
const http = require('http');

const PATCHED = Symbol.for('fhir-server.test.guardMockSocketErrors');

const noop = () => {};

function absorbSharedFdEinval(error) {
    if (!error || error.code !== 'EINVAL') {
        // Being a listener must not change behaviour for other errors: if nothing
        // else is listening, rethrow exactly as an unhandled 'error' would.
        if (this.listenerCount('error') === 1) {
            throw error;
        }
        return;
    }
    // `this` is the MockHttpSocket. Node's socketErrorListener (attached after
    // this prepended listener) forwards the error to the in-flight request; give
    // that request a listener if it has none so the forward cannot throw.
    const request = this._httpMessage;
    if (request && request.listenerCount('error') === 0) {
        request.once('error', noop);
    }
    process.stderr.write(
        `[guardMockSocketErrors] absorbed passthrough socket ${error.message}` +
            (request ? ` (${request.method} ${request.host}${request.path})` : '') +
            '\n'
    );
}

if (!http.ClientRequest.prototype[PATCHED]) {
    const originalOnSocket = http.ClientRequest.prototype.onSocket;

    http.ClientRequest.prototype.onSocket = function onSocket(socket, err) {
        if (socket && socket.constructor && socket.constructor.name === 'MockHttpSocket') {
            // Prepended so it runs before Node's socketErrorListener; also keeps
            // the socket itself from having zero 'error' listeners once the
            // request detaches.
            socket.prependListener('error', absorbSharedFdEinval);
        }
        return originalOnSocket.call(this, socket, err);
    };
    http.ClientRequest.prototype[PATCHED] = true;
}
