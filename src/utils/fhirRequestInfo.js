const {assertIsValid} = require('./assertType');

/**
 * Store information about the HTTP request
 */
class FhirRequestInfo {
    /**
     * class that holds request info
     * @param {string | null} user
     * @param {string} scope
     * @param {string} protocol
     * @param {string|null} originalUrl
     * @param {string | null} [remoteIpAddress]
     * @param {string|null} requestId
     * @param {string | null} [path]
     * @param {string | null} host
     * @param {Object | Object[] | null} [body]
     * @param {string | null} [accept]
     * @param {boolean | null} [isUser]
     * @param {string[] | null} [patientIdsFromJwtToken]
     * @param {string | null} [personIdFromJwtToken]
     * @param {Object} headers
     * @param {string} method
     * @param {import('content-type').ContentType|null} contentTypeFromHeader
     */
    constructor(
        {
            user,
            scope,
            remoteIpAddress,
            requestId,
            protocol,
            originalUrl,
            path,
            host,
            body,
            accept,
            isUser,
            patientIdsFromJwtToken,
            personIdFromJwtToken,
            headers,
            method,
            contentTypeFromHeader
        }
    ) {
        assertIsValid(!user || typeof user === 'string', `user is of type: ${typeof user} but should be string.`);
        /**
         * @type {string|null}
         */
        this.user = user;
        /**
         * @type {string}
         */
        this.scope = scope;
        /**
         * @type {string|null}
         */
        this.remoteIpAddress = remoteIpAddress;
        /**
         * @type {string|null}
         */
        this.requestId = requestId;
        /**
         * @type {string}
         */
        this.protocol = protocol;
        /**
         * @type {string}
         */
        this.originalUrl = originalUrl;
        /**
         * @type {string|null}
         */
        this.path = path;
        /**
         * @type {string|null}
         */
        this.host = host;
        /**
         * @type {Object|Object[]|null}
         */
        this.body = body;
        /**
         * @type {string | null}
         */
        this.accept = accept;
        /**
         * @type {boolean}
         */
        this.isUser = isUser;
        /**
         * @type {string[] | null}
         */
        this.patientIdsFromJwtToken = patientIdsFromJwtToken;
        /**
         * @type {string | null}
         */
        this.personIdFromJwtToken = personIdFromJwtToken;
        /**
         * @type {Object}
         */
        this.headers = headers;
        /**
         * @type {string}
         */
        this.method = method;

        /**
         * @type {import('content-type').ContentType|null}
         */
        this.contentTypeFromHeader = contentTypeFromHeader;
    }
}

module.exports = {
    FhirRequestInfo
};
