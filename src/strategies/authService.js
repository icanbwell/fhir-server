const {ExtractJwt, Strategy: JwtStrategy} = require('passport-jwt');
const async = require('async');
const env = require('var');
const jwksRsa = require('jwks-rsa');
const superagent = require('superagent');
const {LRUCache} = require('lru-cache');
const {
    EXTERNAL_REQUEST_RETRY_COUNT,
    DEFAULT_CACHE_EXPIRY_TIME,
    DEFAULT_CACHE_MAX_COUNT
} = require('../constants');
const {isTrue} = require('../utils/isTrue');
const {logDebug, logError} = require('../operations/common/logging');
const {WellKnownConfigurationManager} = require('../utils/wellKnownConfiguration/wellKnownConfigurationManager');
const {assertTypeEquals} = require("../utils/assertType");
const {ScopesManager} = require("../operations/security/scopesManager");
const {ConfigManager} = require("../utils/configManager");

/**
 * This callback type is called `requestCallback` and is displayed as a global symbol.
 *
 * @callback requestCallback
 * @param {Object} user
 * @param {Object} info
 * @param {Object} [details]
 */

class AuthService {
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

        this.requestTimeout = (parseInt(env.EXTERNAL_REQUEST_TIMEOUT_SEC) || 30) * 1000;
        this.requiredJWTFields = {
            clientFhirPersonId: 'clientFhirPersonId',
            clientFhirPatientId: 'clientFhirPatientId',
            bwellFhirPersonId: 'bwellFhirPersonId',
            bwellFhirPatientId: 'bwellFhirPatientId'
        };
        this.cacheOptions = {
            max: env.CACHE_MAX_COUNT ? Number(env.CACHE_MAX_COUNT) : DEFAULT_CACHE_MAX_COUNT,
            ttl: env.CACHE_EXPIRY_TIME ? Number(env.CACHE_EXPIRY_TIME) : DEFAULT_CACHE_EXPIRY_TIME
        };
        this.jwksCache = new LRUCache(this.cacheOptions);
    }

    // noinspection JSUnusedGlobalSymbols
    clearJwksCache() {
        if (this.jwksCache) {
            this.jwksCache.clear();
        }
    }

    async getJwksByUrlAsync(jwksUrl) {
        if (this.jwksCache.has(jwksUrl)) {
            return this.jwksCache.get(jwksUrl);
        }
        try {
            const res = await superagent
                .get(jwksUrl)
                .set({Accept: 'application/json'})
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(this.requestTimeout);
            const jsonResponse = JSON.parse(res.text);
            this.jwksCache.set(jwksUrl, jsonResponse);
            return jsonResponse;
        } catch (error) {
            logError(`Error while fetching keys from external jwk url: ${jwksUrl}: ${error.message}`, {
                error: error,
                args: {jwksUrl: jwksUrl}
            });
            return {keys: []};
        }
    }

    async getExternalJwksAsync() {
        if (!env.EXTERNAL_AUTH_JWKS_URLS && !env.EXTERNAL_AUTH_WELL_KNOWN_URLS) {
            return [];
        }
        let extJwksUrls = env.EXTERNAL_AUTH_JWKS_URLS ? env.EXTERNAL_AUTH_JWKS_URLS.split(',') : [];
        if (!env.EXTERNAL_AUTH_JWKS_URLS && env.EXTERNAL_AUTH_WELL_KNOWN_URLS) {
            const wellKnownConfigurationManager = new WellKnownConfigurationManager({
                urlList: env.EXTERNAL_AUTH_WELL_KNOWN_URLS
            });
            extJwksUrls = await wellKnownConfigurationManager.getJwksUrls();
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

    parseUserInfoFromPayload({username, subject, isUser, jwt_payload, done, client_id, scope}) {
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
        }
        logDebug(`JWT payload`, {user: '', args: {jwt_payload}});
        done(null, {id: client_id, isUser, name: username, username}, {scope, context});
    }

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

    getScopesFromToken(jwt_payload) {
        let scope = jwt_payload.scope
            ? jwt_payload.scope
            : this.getPropertiesFromPayload({
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_SCOPE
            }).join(' ');

        const groups = this.getPropertiesFromPayload({
            jwt_payload,
            propertyNames: env.AUTH_CUSTOM_GROUP
        });
        logDebug(`JWT groups`, {user: '', args: {groups}});

        if (groups.length > 0) {
            scope = scope ? scope + ' ' + groups.join(' ') : groups.join(' ');
        }

        const scopes = scope ? scope.split(' ') : [];
        const username = jwt_payload.username
            ? jwt_payload.username
            : this.getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_USERNAME
            });

        const subject = jwt_payload.subject
            ? jwt_payload.subject
            : this.getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_SUBJECT
            });

        const clientId = jwt_payload.client_id
            ? jwt_payload.client_id
            : this.getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_CLIENT_ID
            });

        const isUser = scopes.some((s) => s.toLowerCase().startsWith('patient/'));

        return {scope, isUser, username, subject};
    }

    async getUserInfoFromUserInfoEndpoint({jwt_payload, token}) {
        const wellKnownConfigurationManager = new WellKnownConfigurationManager({
            urlList: env.EXTERNAL_AUTH_WELL_KNOWN_URLS
        });
        const wellKnownConfig = await wellKnownConfigurationManager.getWellKnownConfigurationForIssuer(
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
                const {scope, isUser, username, subject} = this.getScopesFromToken(jwt_payload);
                return {scope, isUser, username, subject};
            }
        }
        return jwt_payload;
    }

    /**
     * extracts the client_id and scope from the decoded token
     * @param {import('http').IncomingMessage} _request
     * @param {Object} jwt_payload
     * @param {requestCallback} done
     * @return {void}
     */
    verify(_request, jwt_payload, done) {
        if (jwt_payload) {
            let {scope, isUser, username, subject, clientId} = this.getScopesFromToken(jwt_payload);

            // if there are no scopes try to get the userInfo from userInfo endpoint
            if (!scope && jwt_payload.iss) {
                const token = _request.query && _request.query.token;
                this.getUserInfoFromUserInfoEndpoint(
                    {jwt_payload, token}
                ).then((userInfo) => {
                    if (userInfo) {
                        ({scope, isUser, username, subject} = this.getScopesFromToken(userInfo));
                        this.parseUserInfoFromPayload({
                            username: username,
                            subject: subject,
                            isUser,
                            jwt_payload,
                            done,
                            client_id: clientId,
                            scope
                        });
                    } else {
                        this.parseUserInfoFromPayload({
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
                    this.parseUserInfoFromPayload({
                        username: username,
                        subject: subject,
                        isUser,
                        jwt_payload,
                        done,
                        client_id: clientId,
                        scope
                    });
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
                this.parseUserInfoFromPayload({
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
            done(
                null
                ,
                false
            )
            ;
        }
    }
    ;

}

module.exports = {
    AuthService
};
