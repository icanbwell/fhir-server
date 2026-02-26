const { assertIsValid } = require('./assertType');
const { isTrue } = require('./isTrue');

/**
 * Store information about the HTTP request
 */
class FhirRequestInfo {
    /**
     * class that holds request info
     * @param {Object} params
     * @param {string | null} params.user
     * @param {string} params.alternateUserId
     * @param {string} params.scope
     * @param {string} params.protocol
     * @param {string|null} params.originalUrl
     * @param {string | null} params.remoteIpAddress
     * @param {string|null} params.requestId
     * @param {string|null} params.userRequestId
     * @param {string | null} params.path
     * @param {string | null} params.host
     * @param {Object | Object[] | null} params.body
     * @param {string | string[] | null} params.accept
     * @param {boolean | null} params.isUser
     * @param {string | null} params.personIdFromJwtToken
     * @param {string | null} params.masterPersonIdFromJwtToken
     * @param {string | null} params.managingOrganizationId
     * @param {Object} params.headers
     * @param {string} params.method
     * @param {import('content-type').ContentType|null} params.contentTypeFromHeader
     */
    constructor (
        {
            user,
            scope,
            remoteIpAddress,
            requestId,
            userRequestId,
            protocol,
            originalUrl,
            path,
            host,
            body,
            accept,
            isUser,
            personIdFromJwtToken,
            masterPersonIdFromJwtToken,
            managingOrganizationId,
            headers,
            method,
            contentTypeFromHeader,
            alternateUserId
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
         * @type {string|null}
         */
        this.userRequestId = userRequestId;
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
         * @type {string | string[] | null}
         */
        this.accept = accept;
        /**
         * @type {boolean}
         */
        this.isUser = isUser;
        /**
         * @type {string | null}
         */
        this.alternateUserId = alternateUserId;
        /**
         * @type {string | null}
         */
        this.personIdFromJwtToken = personIdFromJwtToken;
        /**
         * @type {string | null}
         */
        this.masterPersonIdFromJwtToken = masterPersonIdFromJwtToken;
        /**
         * @type {string | null}
         */
        this.managingOrganizationId = managingOrganizationId;
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

        /**
         * whether the client wants to use global ids
         * @type {boolean}
         */
        this.preferGlobalId = headers.Prefer && isTrue(headers.Prefer.replace('global_id=', ''));
    }

    /**
     * Check if the cached response can be returned
     * @returns {boolean}
     */
    skipCachedData() {
        return this.headers?.['cache-control'] === 'no-cache';
    }
}

module.exports = {
    FhirRequestInfo
};
