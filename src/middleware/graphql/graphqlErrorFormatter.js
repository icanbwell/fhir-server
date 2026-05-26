/**
 * Express error-handling middleware for GraphQL routes.
 * Formats errors as GraphQL-shaped responses (HTTP 200 + {"errors": [...], "data": null})
 * for federation router compatibility. Cosmo router expects subgraphs to return
 * application-level errors in the response body, not via HTTP status codes.
 */
const graphqlErrorFormatter = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    const message = err.message || 'Internal server error';
    const code = err.statusCode === 401 ? 'UNAUTHENTICATED'
        : err.statusCode === 403 ? 'FORBIDDEN'
        : 'INTERNAL_SERVER_ERROR';

    res.status(200).json({
        errors: [{
            message,
            extensions: { code }
        }],
        data: null
    });
};

module.exports = { graphqlErrorFormatter };
