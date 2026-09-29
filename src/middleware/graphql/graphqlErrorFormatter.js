/**
 * Determines the safe message to expose to a GraphQL caller for a given error,
 * mirroring convertErrorToOperationOutcome's `internalError` handling on the REST
 * path: 4xx (client) errors remain descriptive, 5xx/unclassified (internal) errors
 * are redacted so implementation details (hostnames, connection strings,
 * stack-derived strings, etc.) are never leaked to callers.
 *
 * Used both by graphqlErrorFormatter (pre-execution failures reached via
 * `next(err)`, e.g. auth/body-parsing errors) and by the `formatError` callbacks
 * configured on the Apollo Server instances in graphqlServer.js/graphqlServerV2.js
 * (errors thrown inside resolvers/data sources, which Apollo handles itself and
 * never reach graphqlErrorFormatter) so both paths classify/redact consistently.
 * @param {Error} err
 * @return {string}
 */
const getSafeErrorMessage = (err) => {
    const statusCode = (err && typeof err.statusCode === 'number') ? err.statusCode : 500;
    return statusCode >= 500 ? 'Internal server error' : ((err && err.message) || 'Internal server error');
};

/**
 * Express error-handling middleware for GraphQL routes.
 * Formats errors as GraphQL-shaped responses for federation router compatibility.
 * Per GraphQL over HTTP spec, pre-execution errors (auth, forbidden) omit the
 * "data" field entirely and use an appropriate 4xx status code.
 * The Cosmo router parses responses looking for "errors" or "data" fields;
 * as long as "errors" is present, it will propagate the error correctly.
 *
 * NOTE: this middleware is registered after Apollo's `expressMiddleware` on the
 * GraphQL routers (see src/app.js) and is only reached via `next(err)`, i.e. for
 * pre-execution failures. Errors thrown inside resolvers/data loaders are handled
 * by Apollo itself (see the `formatError` callbacks in graphqlServer.js and
 * graphqlServerV2.js) and respond with HTTP 200 without ever calling `next(err)`.
 */
const graphqlErrorFormatter = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    const statusCode = err.statusCode || 500;
    // Redact internal error details for 5xx responses, mirroring
    // convertErrorToOperationOutcome's `internalError` handling on the REST path,
    // so implementation details (hostnames, connection strings, stack-derived
    // strings, etc.) are never leaked to callers. 4xx messages remain descriptive.
    const message = getSafeErrorMessage(err);
    const code = statusCode === 401 ? 'UNAUTHENTICATED'
        : statusCode === 403 ? 'FORBIDDEN'
        : 'INTERNAL_SERVER_ERROR';

    res.status(statusCode).json({
        errors: [{
            message,
            extensions: { code }
        }]
    });
};

module.exports = { graphqlErrorFormatter, getSafeErrorMessage };
