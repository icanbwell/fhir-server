const { unwrapResolverError } = require('@apollo/server/errors');
const { isPoolWaitTimeoutError } = require('../../utils/mongoPoolWaitRetry');

const STATUS_CODE_TO_GRAPHQL_CODE = Object.freeze({
    400: 'BAD_USER_INPUT',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    412: 'PRECONDITION_FAILED',
    504: 'DOWNSTREAM_TIMEOUT'
});

const INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR';
const DOWNSTREAM_TIMEOUT = 'DOWNSTREAM_TIMEOUT';

/**
 * Maps an error thrown inside a resolver or data source to an `extensions.code`.
 * @param {Error} originalError
 * @return {string}
 */
const getCodeForOriginalError = (originalError) => {
    if (isPoolWaitTimeoutError(originalError)) {
        return DOWNSTREAM_TIMEOUT;
    }
    const statusCode = originalError && originalError.statusCode;
    return STATUS_CODE_TO_GRAPHQL_CODE[statusCode] || INTERNAL_SERVER_ERROR;
};

/**
 * Returns the `extensions.code` for an error Apollo reports. Errors thrown from resolvers get
 * a code from their `statusCode` (or a Mongo pool wait timeout). Parse, validation and other
 * errors Apollo raises itself keep the code Apollo gave them.
 * @param {import('graphql').GraphQLError} error
 * @return {string}
 */
const getGraphQlErrorCode = (error) => {
    const originalError = unwrapResolverError(error);
    if (originalError !== error) {
        return getCodeForOriginalError(originalError);
    }
    return (error && error.extensions && error.extensions.code) || INTERNAL_SERVER_ERROR;
};

module.exports = { getGraphQlErrorCode, STATUS_CODE_TO_GRAPHQL_CODE };
