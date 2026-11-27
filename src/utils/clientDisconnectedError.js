/**
 * Thrown to stop in-flight work for a request whose client has already disconnected.
 * There is nobody left to answer, so callers should stop quietly instead of writing a response.
 */
class ClientDisconnectedError extends Error {
    constructor () {
        super('Client disconnected before the request completed');
        this.name = 'ClientDisconnectedError';
    }
}

module.exports = { ClientDisconnectedError };
