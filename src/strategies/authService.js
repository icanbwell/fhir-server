const async = require('async');
const superagent = require('superagent');
const {LRUCache} = require('lru-cache');
const {
    EXTERNAL_REQUEST_RETRY_COUNT,
    DEFAULT_CACHE_EXPIRY_TIME,
    DEFAULT_CACHE_MAX_COUNT,
    USER_INFO_CACHE_EXPIRY_TIME
} = require('../constants');
const {logDebug, logError, logInfo} = require('../operations/common/logging');
const {WellKnownConfigurationManager} = require('../utils/wellKnownConfiguration/wellKnownConfigurationManager');
const {assertTypeEquals} = require("../utils/assertType");
const {ConfigManager} = require("../utils/configManager");

/**
 * @typedef {Object} UserInfo
 * @property {string} username - The username of the user.
 * @property {string} subject - The subject of the user.
 * @property {boolean} isUser - Indicates if the user is a regular user.
 * @property {string} scope - The scope of the user.
 * @property {string} clientId - The client ID of the user.
 */

class AuthService {
    /**
     * Cache for configuration data.
     * @type {LRUCache<{}, {}, any>}
     */
    static jwksCache;

    /**
     * Cache for user info data.
     * @type {LRUCache<{}, {}, any>}
     */
    static userInfoCache;

    /**
     * Constructor for the AuthService
     * @param {ConfigManager} configManager
     * @param {WellKnownConfigurationManager} wellKnownConfigurationManager
     */
    constructor({
                    configManager,
                    wellKnownConfigurationManager
                }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {WellKnownConfigurationManager}
         */
        this.wellKnownConfigurationManager = wellKnownConfigurationManager;
        assertTypeEquals(wellKnownConfigurationManager, WellKnownConfigurationManager);

        this.requestTimeout = (this.configManager.externalRequestTimeoutSec || 30) * 1000;
        this.requiredJWTFields = {
            clientFhirPersonId: 'clientFhirPersonId',
            clientFhirPatientId: 'clientFhirPatientId',
            bwellFhirPersonId: 'bwellFhirPersonId',
            bwellFhirPatientId: 'bwellFhirPatientId'
        };
        this.optionalJWTFields = {
            bwellManagingOrganizationId: 'managingOrganization'
        };
        this.cacheOptions = {
            max: DEFAULT_CACHE_MAX_COUNT,
            ttl: DEFAULT_CACHE_EXPIRY_TIME
        };

        /**
         * @type {string}
         */
        this.cidCheckIssuer = this.configManager.authCidCheckIssuer;

        /**
         * @type {string[]}
         */
        this.cidCheckClientIds = this.configManager.authCidCheckClientIds;

        if (AuthService.jwksCache === undefined) {
        AuthService.jwksCache = new LRUCache(this.cacheOptions);
        }

        if (AuthService.userInfoCache === undefined) {
            AuthService.userInfoCache = new LRUCache({
                max: DEFAULT_CACHE_MAX_COUNT,
                ttl: USER_INFO_CACHE_EXPIRY_TIME
            });
        }
    }

    /**
     * Clears the JWKS cache.
     */
    clearAuthCache() {
        if (AuthService.jwksCache) {
            AuthService.jwksCache.clear();
        }
        if (AuthService.userInfoCache) {
            AuthService.userInfoCache.clear();
        }
    }

    /**
     * Fetches JWKS from a given URL and caches the result.
     * @param {string} jwksUrl
     * @returns {Promise<{keys: Object[]}>}
     */
    async getJwksByUrlAsync(jwksUrl) {
        if (AuthService.jwksCache.has(jwksUrl)) {
            return AuthService.jwksCache.get(jwksUrl);
        }
        try {
            const res = await superagent
                .get(jwksUrl)
                .set({Accept: 'application/json'})
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(this.requestTimeout);
            const jsonResponse = JSON.parse(res.text);
            AuthService.jwksCache.set(jwksUrl, jsonResponse);
            return jsonResponse;
        } catch (error) {
            logError(`Error while fetching keys from external jwk url: ${jwksUrl}: ${error.message}`, {
                error: error,
                args: {jwksUrl: jwksUrl}
            });
            return {keys: []};
        }
    }

    /**
     * Fetches external JWKS URLs and retrieves the keys from them.
     * @returns {Promise<Object[]>}
     */
    async getExternalJwksAsync() {
        if (this.configManager.externalAuthJwksUrls.length === 0 && this.configManager.externalAuthWellKnownUrls.length === 0) {
            return [];
        }
        let extJwksUrls = this.configManager.externalAuthJwksUrls;
        if (extJwksUrls.length === 0 && this.configManager.externalAuthWellKnownUrls.length > 0) {
            extJwksUrls = await this.wellKnownConfigurationManager.getJwksUrlsAsync();
        }
        if (extJwksUrls.length > 0) {
            try {
                const keysArray = await async.map(
                    extJwksUrls,
                    async (extJwksUrl) => (await this.getJwksByUrlAsync(extJwksUrl.trim())).keys
                );
                return keysArray.flat(2);
            } catch (error) {
                logError(`Error while fetching keys from external jwk urls: ${error.message}`, {
                    error: error,
                    args: {extJwksUrls: extJwksUrls}
                });
                return [];
            }
        }
        return [];
    }

    /**
     * Extracts the JWT token from the request.
     * @param {import('http').IncomingMessage} req
     * @returns {string|null}
     */
    cookieExtractor(req) {
        let token = null;
        if (req && req.cookies) {
            token = req.cookies.jwt;
            logDebug('Found cookie jwt', {user: '', args: {token}});
        } else {
            logDebug('No cookies found', {user: ''});
        }
        return token;
    }

    /**
     * Parses user info from passed in JWT payload.
     * @param {string|undefined} username
     * @param {string|undefined}  subject
     * @param {boolean} isUser
     * @param {Object} jwt_payload
     * @param {import("passport-jwt").VerifiedCallback} done
     * @param {string} client_id
     * @param {string} scope
     * @return {void}
     */
    processUserInfo({username, subject, isUser, jwt_payload, done, client_id, scope}) {
        const context = {};
        if (username) {
            context.username = username;
        }
        if (subject) {
            context.subject = subject;
        }
        if (isUser) {
            context.isUser = isUser;
            let validInput = true;
            Object.values(this.requiredJWTFields).forEach((field) => {
                if (!jwt_payload[field]) {
                    logDebug(`Error: ${field} field is missing`, {user: ''});
                    validInput = false;
                }
            });
            if (!validInput) {
                done(null, false);
                return;
            }
            context.personIdFromJwtToken = jwt_payload[this.requiredJWTFields.clientFhirPersonId];
            context.masterPersonIdFromJwtToken = jwt_payload[this.requiredJWTFields.bwellFhirPersonId];
            context.managingOrganizationId = jwt_payload[this.optionalJWTFields.bwellManagingOrganizationId];

            context.subject = jwt_payload['sub'];
            context.username = context.personIdFromJwtToken;
        }
        logDebug(`JWT payload`, {user: '', args: {jwt_payload}});

        const effectiveUsername = context.username || username;
        done(null, {id: client_id, isUser, name: effectiveUsername, username: effectiveUsername}, {scope, context});
    }

    /**
     * Extracts properties from the JWT payload based on the provided property names.
     * @param {Object} jwt_payload
     * @param {string|string[]|undefined} propertyNames
     * @returns {string[]}
     */
    getPropertiesFromPayload({jwt_payload, propertyNames}) {
        if (propertyNames && typeof propertyNames === 'string') {
            propertyNames = propertyNames.split(',').map((s) => s.trim());
        }
        if (propertyNames && propertyNames.length > 0) {
            return propertyNames
                .map((propertyName) => {
                    if (jwt_payload[propertyName]) {
                        return Array.isArray(jwt_payload[propertyName])
                            ? jwt_payload[propertyName].join(' ')
                            : jwt_payload[propertyName];
                    }
                    return null;
                })
                .filter((property) => property !== null);
        }
        return [];
    }

    /**
     * Extracts the first property from the JWT payload based on the provided property names.
     * @param {Object} jwt_payload
     * @param {string|string[]|undefined} propertyNames
     * @returns {string|null}
     */
    getFirstPropertyFromPayload({jwt_payload, propertyNames}) {
        if (propertyNames && typeof propertyNames === 'string') {
            propertyNames = propertyNames.split(',').map((s) => s.trim());
        }
        if (propertyNames && propertyNames.length > 0) {
            for (const propertyName of propertyNames) {
                if (jwt_payload[propertyName]) {
                    return Array.isArray(jwt_payload[propertyName])
                        ? jwt_payload[propertyName].join(' ')
                        : jwt_payload[propertyName];
                }
            }
        }
        return null;
    }

    /**
     * Extracts fields from the JWT payload.
     * @param {Object} jwt_payload
     * @returns {{scope: string, isUser: boolean, username: string|undefined, subject: string|undefined, clientId: string|undefined}}
     */
    getFieldsFromToken(jwt_payload) {
        /**
         * @type {string|undefined}
         */
        let scope = jwt_payload.scope
            ? jwt_payload.scope
            : this.getPropertiesFromPayload({
                jwt_payload,
                propertyNames: this.configManager.authCustomScope
            }).join(' ');

        /**
         * @type {string[]}
         */
        const groups = this.getPropertiesFromPayload({
            jwt_payload,
            propertyNames: this.configManager.authCustomGroup
        });
        logDebug(`JWT groups`, {user: '', args: {groups}});

        if (groups.length > 0) {
            scope = scope ? scope + ' ' + groups.join(' ') : groups.join(' ');
        }

        /**
         * @type {string[]}
         */
        let scopes = scope ? scope.split(' ') : [];
        // ignore defined prefixes
        /**
         * @type {string[]}
         */
        const authRemoveScopePrefixes = this.configManager.authRemoveScopePrefixes;
        if (authRemoveScopePrefixes && authRemoveScopePrefixes.length > 0) {
            scopes = scopes.map(
                (s) => {
                    for (const prefix of authRemoveScopePrefixes) {
                        if (s.startsWith(prefix)) {
                            return s.substring(prefix.length);
                        }
                    }
                    return s;
                }
            );
            scope = scopes.join(' ');
        }

        const username = jwt_payload.username
            ? jwt_payload.username
            : this.getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: this.configManager.authCustomUserName
            });

        const subject = jwt_payload.subject
            ? jwt_payload.subject
            : this.getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: this.configManager.authCustomSubject
            });

        const clientId = jwt_payload.client_id
            ? jwt_payload.client_id
            : this.getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: this.configManager.authCustomClientId
            });

        const isUser = scopes.some((s) => s.toLowerCase().startsWith('patient/'));

        return {scope, isUser, username, subject, clientId};
    }

    /**
     * fetches the user info from the userInfo endpoint
     * @param {Object} jwt_payload
     * @param {string} token
     * @returns {Promise<UserInfo|undefined>}
     */
    async getUserInfoFromUserInfoEndpoint({jwt_payload, token}) {
        const cacheKey = jwt_payload.iss && jwt_payload.sub && jwt_payload.cid ? `${jwt_payload.iss}-${jwt_payload.cid}-${jwt_payload.sub}` : null;
        if (cacheKey && AuthService.userInfoCache.has(cacheKey)) {
            return AuthService.userInfoCache.get(cacheKey);
        }
        const wellKnownConfig = await this.wellKnownConfigurationManager.getWellKnownConfigurationForIssuerAsync(
            jwt_payload.iss
        );
        if (wellKnownConfig && wellKnownConfig.userinfo_endpoint) {
            const userInfoResponse = await superagent
                .get(wellKnownConfig.userinfo_endpoint)
                .set({
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`
                })
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(this.requestTimeout);
            if (userInfoResponse && userInfoResponse.body) {
                jwt_payload = userInfoResponse.body;
                const userInfo = this.getFieldsFromToken(jwt_payload);
                if (cacheKey) {
                    AuthService.userInfoCache.set(cacheKey, userInfo);
                }
                return userInfo;
            }
        }
        return jwt_payload;
    }

    /**
     * extracts the client_id and scope from the decoded token
     * @typedef {object} verifyParams
     * @property {import('http').IncomingMessage} request
     * @property {Object} jwt_payload
     * @property {string} token
     * @property {import("passport-jwt").VerifiedCallback} done
     *
     * @param {verifyParams} params
     * @return {void}
     */
    verify({request, jwt_payload, token, done}) {
        if (jwt_payload) {
            if (this.cidCheckIssuer && jwt_payload.iss === this.cidCheckIssuer) {
                if (!this.cidCheckClientIds.includes(jwt_payload.cid)) {
                    logInfo(`Client ID ${jwt_payload.cid} is not allowed from issuer ${jwt_payload.iss}`, {
                        userClaim: jwt_payload.sub
                    });
                    return done(null, false);
                }
            }

            let {scope, isUser, username, subject, clientId} = this.getFieldsFromToken(jwt_payload);

            // if there are no scopes try to get the userInfo from userInfo endpoint
            if (!scope && jwt_payload.iss) {
                this.getUserInfoFromUserInfoEndpoint(
                    {jwt_payload, token}
                ).then((userInfo) => {
                    if (userInfo) {
                        const {
                            scope: scope1,
                            isUser: isUser1,
                            username: username1,
                            subject: subject1,
                            clientId: clientId1
                        } = this.getFieldsFromToken(userInfo);
                        this.processUserInfo({
                            username: username1 || username,
                            subject: subject1 || subject,
                            isUser: isUser1 || isUser,
                            jwt_payload,
                            done,
                            client_id: clientId1 || clientId,
                            scope: scope1 || scope
                        });
                    } else {
                        this.processUserInfo({
                            username: username,
                            subject: subject,
                            isUser,
                            jwt_payload,
                            done,
                            client_id: clientId,
                            scope
                        });
                    }

                }).catch((error) => {
                    logError(`Error while fetching user info: ${error.message}`, {error: error});
                    done(null, false);
                });
            } else {
                logDebug(`JWT result`, {
                    user: '', args: {
                        result: {
                            username: username,
                            subject: subject,
                            isUser,
                            jwt_payload,
                            done,
                            client_id: clientId,
                            scope
                        }
                    }
                });
                this.processUserInfo({
                    username: username,
                    subject: subject,
                    isUser,
                    jwt_payload,
                    done,
                    client_id: clientId,
                    scope
                });
            }
        } else {
            done(null, false);
        }
    }

}

module.exports = {
    AuthService
};
