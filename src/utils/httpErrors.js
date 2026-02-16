/**
 * This file implements custom HTTP errors for the FHIR server
 */

const { ServerError } = require('../middleware/fhir/utils/server.error');

class BadRequestError extends ServerError {
    constructor (error, options = {}) {
        const operationOutcomeIssue = {
            severity: 'error',
            code: 'invalid',
            details: { text: error.message }
        };
        if (Object.hasOwn(error, 'stack')) {
            operationOutcomeIssue.diagnostics = error.stack;
        }
        super(error.message, {
            // Set this to make the HTTP status code 409
            statusCode: 400,
            // Add any normal operation outcome stuff here
            issue: [
                operationOutcomeIssue
            ]
        });
        this.logLevel = 'info';

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 400;
    }
}

class NotFoundError extends ServerError {
    constructor (message, options = {}) {
        super(message, {
            // Set this to make the HTTP status code 409
            statusCode: 404,
            // Add any normal operation outcome stuff here
            issue: [
                {
                    severity: 'error',
                    code: 'not-found',
                    details: { text: message }
                }
            ]
        });

        this.name = 'NotFound';
        this.logLevel = 'info';

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 404;
    }
}

class NotAllowedError extends ServerError {
    constructor (message, options = {}) {
        super(message, {
            // Set this to make the HTTP status code 409
            statusCode: 409,
            // Add any normal operation outcome stuff here
            issue: [
                {
                    severity: 'error',
                    code: 'forbidden',
                    details: { text: message }
                }
            ]
        });
        this.logLevel = 'info';

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 409;
    }
}

class NotValidatedError extends ServerError {
    /**
     * constructor
     * @param {OperationOutcome} operationOutcome
     * @param {Object} options
     */
    constructor (operationOutcome, options = {}) {
        super('Validation Failed', {
            // Set this to make the HTTP status code 400
            statusCode: 400,
            // Add any normal operation outcome stuff here
            issue: operationOutcome.issue
        });

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 400;
    }
}

class UnauthorizedError extends ServerError {
    constructor (message, options = {}) {
        super(message, {
            // Set this to make the HTTP status code 401
            statusCode: 401,
            // Add any normal operation outcome stuff here
            issue: [
                {
                    severity: 'error',
                    code: 'security',
                    details: { text: message }
                }
            ]
        });

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 401;
    }
}

class ForbiddenError extends ServerError {
    constructor (message, options = {}) {
        super(message, {
            // Set this to make the HTTP status code 401
            statusCode: 403,
            // Add any normal operation outcome stuff here
            // https://www.hl7.org/fhir/valueset-issue-type.html
            issue: [
                {
                    severity: 'error',
                    code: 'forbidden',
                    details: { text: message },
                    diagnostics: message
                }
            ]
        });

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 403;
    }
}

class ExternalTimeoutError extends ServerError {
    constructor (message, options = {}) {
        super(message, {
            statusCode: 504,
            // Add any normal operation outcome stuff here
            // https://www.hl7.org/fhir/valueset-issue-type.html
            issue: [
                {
                    severity: 'error',
                    code: 'timeout',
                    details: { text: message }
                }
            ]
        });

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 504;
    }
}

class PreconditionFailedError extends ServerError {
    constructor (message, options = {}) {
        super(message, {
            statusCode: 412,
            // Add any normal operation outcome stuff here
            // https://www.hl7.org/fhir/valueset-issue-type.html
            issue: [
                {
                    severity: 'error',
                    code: 'precondition-failed',
                    details: { text: message }
                }
            ]
        });

        // You can attach relevant information to the error instance
        // (e.g.. the username)

        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
    }

    get statusCode () {
        return 412;
    }
}

module.exports = {
    BadRequestError,
    NotFoundError,
    NotAllowedError,
    NotValidatedError,
    UnauthorizedError,
    ForbiddenError,
    ExternalTimeoutError,
    PreconditionFailedError
};
