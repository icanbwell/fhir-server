/**
 * Express error-handling middleware for GraphQL routes.
 * Formats errors as GraphQL-shaped responses for federation router compatibility.
 * Per GraphQL over HTTP spec, pre-execution errors (auth, forbidden) omit the
 * "data" field entirely and use an appropriate 4xx status code.
 * The Cosmo router parses responses looking for "errors" or "data" fields;
 * as long as "errors" is present, it will propagate the error correctly.
 */
const graphqlErrorFormatter = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    const message = err.message || 'Internal server error';
    const statusCode = err.statusCode || 500;
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

module.exports = { graphqlErrorFormatter };
