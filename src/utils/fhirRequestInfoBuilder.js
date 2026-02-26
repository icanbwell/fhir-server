const { assertIsValid } = require('./assertType');
const contentType = require('content-type');
const httpContext = require('express-http-context');
const accepts = require('accepts');
const { REQUEST_ID_TYPE } = require('../constants');
const { FhirRequestInfo } = require('./fhirRequestInfo');
const { logError } = require('../operations/common/logging');

/**
 * Builder class for constructing FhirRequestInfo instances from HTTP requests
 */
class FhirRequestInfoBuilder {
    /**
     * @param {import('http').IncomingMessage} req
     */
    constructor(req) {
        assertIsValid(req, 'req is null');
        this.req = req;
    }

    /**
     * Static factory method to build FhirRequestInfo from request
     * @param {import('http').IncomingMessage} req
     * @returns {FhirRequestInfo}
     */
    static fromRequest(req) {
        return new FhirRequestInfoBuilder(req).build();
    }

    /**
     * Gets isUser flag from the request
     * @returns {boolean | undefined}
     */
    get isUser() {
        return this.req.authInfo?.context?.isUser;
    }

    /**
     * Gets person ID from JWT token
     * @returns {string | undefined}
     */
    get personId() {
        return this.req.authInfo?.context?.personIdFromJwtToken;
    }

    /**
     * Extracts user information from the request
     * For patient scoped tokens (isUser), returns personIdFromJwtToken
     * @returns {string | null}
     * @private
     */
    extractUser() {
        // If token is patient scoped (isUser), use personIdFromJwtToken as user
        if (this.isUser && this.personId) {
            return this.personId;
        }

        return this.req.authInfo?.context?.username ||
            this.req.authInfo?.context?.subject ||
            ((!this.req.user || typeof this.req.user === 'string') ? this.req.user : this.req.user?.name || this.req.user?.id);
    }

    /**
     * Extracts and formats host from the request
     * Includes port if protocol is not https and port exists
     * @returns {string | null}
     * @private
     */
    extractHost() {
        let host = this.req.hostname;
        const protocol = this.req.protocol;

        // Add port if protocol is not https and port exists
        if (protocol !== 'https' && this.req.headers.host) {
            try {
                const url = new URL(`${protocol}://${this.req.headers.host}`);
                if (url.port) {
                    host = `${this.req.hostname}:${url.port}`;
                }
            } catch (err) {
               logError(
                    `hostName: Invalid host header, unable to parse port ${this.req.headers.host}`,
                    {
                        args: {
                            error: err.message,
                            source: 'fhirRequestInfoBuilder',
                            requestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID)
                        }
                    }
                );
            }
        }

        return host;
    }

    /**
     * Alternate user ID.
     * For patient scoped token, returns the sub from token else same as user.
     * @returns {string | null}
     */
    get alternateUserId() {
        return this.isUser ? this.req.authInfo?.context?.subject : this.extractUser();
    }

    /**
     * Builds and returns a FhirRequestInfo instance
     * @param {Partial<ConstructorParameters<typeof FhirRequestInfo>[0]>} [overrides={}] - Optional overrides for FhirRequestInfo properties
     * @returns {FhirRequestInfo}
     */
    build(overrides = {}) {
        const headers = this.req.headers;

        return new FhirRequestInfo({
            user: this.extractUser(),
            alternateUserId: this.alternateUserId,
            scope: this.req.authInfo?.scope,
            remoteIpAddress: this.req.socket.remoteAddress,
            requestId: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID) || this.req.requestId,
            userRequestId: httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID) || this.req.userRequestId,
            protocol: this.req.protocol,
            originalUrl: this.req.originalUrl,
            path: this.req.path,
            host: this.extractHost(),
            body: this.req.body,
            accept: accepts(this.req).types(),
            isUser: this.isUser,
            personIdFromJwtToken: this.personId,
            masterPersonIdFromJwtToken: this.req.authInfo?.context?.masterPersonIdFromJwtToken,
            managingOrganizationId: this.req.authInfo?.context?.managingOrganizationId,
            headers: headers,
            method: this.req.method,
            contentTypeFromHeader: headers['content-type'] ? contentType.parse(headers['content-type']) : null,
            ...overrides
        });
    }
}

module.exports = {
    FhirRequestInfoBuilder
};
