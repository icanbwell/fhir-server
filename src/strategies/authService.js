const superagent = require('superagent');
const {LRUCache} = require('lru-cache');
const {
    EXTERNAL_REQUEST_RETRY_COUNT,
    DEFAULT_CACHE_EXPIRY_TIME,
    DEFAULT_CACHE_MAX_COUNT,
    USER_INFO_CACHE_EXPIRY_TIME,
    AUTH_USER_TYPES
} = require('../constants');
const {logDebug, logError, logInfo, logWarn} = require('../operations/common/logging');
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
     * In-flight JWKS fetches, keyed by URL, used to coalesce concurrent cache-miss
     * requests for the same URL into a single outbound fetch (avoids a thundering
     * herd of duplicate external calls when the cache entry expires under load).
     * @type {Map<string, Promise<{keys: Object[]}>>}
     */
    static jwksFetchInFlight = new Map();

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
            managingOrganization: 'managingOrganization'
        };
        this.allowedJWTUserTypes = [AUTH_USER_TYPES.cmsPartnerUser];
        this.cacheOptions = {
            max: DEFAULT_CACHE_MAX_COUNT,
            ttl: DEFAULT_CACHE_EXPIRY_TIME
        };
        this.requiredActorFields = {
            reference: 'reference',
            sub: 'sub'
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
        // Coalesce concurrent cache-miss requests for the same URL into a single fetch
        // instead of each caller independently hitting the external JWKS endpoint.
        const inFlightFetch = AuthService.jwksFetchInFlight.get(jwksUrl);
        if (inFlightFetch) {
            return inFlightFetch;
        }
        const fetchPromise = (async () => {
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
                logError(`Error fetching JWKS from ${jwksUrl}: ${error.message}`, {
                    error: error,
                    args: {jwksUrl}
                });
                // Do NOT return {keys: []} here: an empty keyset is indistinguishable
                // downstream from "this JWKS endpoint legitimately has no keys" (a
                // permanent condition), when the truth is "we couldn't reach it right
                // now" (transient infrastructure failure, e.g. Redis eviction/outage).
                // Mark the error as transient/retriable and rethrow so callers (and
                // ultimately the auth middleware) surface a 503, not a 401 (INC-322).
                error.isTransient = true;
                if (!error.statusCode) {
                    error.statusCode = 503;
                }
                throw error;
            } finally {
                AuthService.jwksFetchInFlight.delete(jwksUrl);
            }
        })();
        AuthService.jwksFetchInFlight.set(jwksUrl, fetchPromise);
        return fetchPromise;
    }

    /**
     * Fetches external JWKS URLs and retrieves the keys from them.
     *
     * Uses Promise.allSettled (not a fail-fast aggregator like async.map) so that one
     * dead JWKS provider among several configured ones doesn't take down auth for
     * tokens signed by a different, healthy provider. Keys are collected from every
     * URL that succeeded; a transient/503 error is only thrown when EVERY URL failed,
     * i.e. there are truly zero usable external keys (INC-322: an infrastructure
     * outage must not look like "no external keys configured").
     * @returns {Promise<Object[]>}
     */
    async getExternalJwksAsync() {
        if (this.configManager.externalAuthJwksUrls.length === 0 && this.configManager.externalAuthWellKnownUrls.length === 0) {
            return [];
        }
        let extJwksUrls = this.configManager.externalAuthJwksUrls;
        if (extJwksUrls.length === 0 && this.configManager.externalAuthWellKnownUrls.length > 0) {
            // getJwksUrlsAsync() throws a transient/503-marked error if EVERY configured
            // well-known URL failed to resolve (INC-322) -- let that propagate below
            // rather than treating a total well-known outage the same as "no well-known
            // URLs configured at all" (which legitimately resolves to []).
            extJwksUrls = await this.wellKnownConfigurationManager.getJwksUrlsAsync();
        }
        if (extJwksUrls.length > 0) {
            const results = await Promise.allSettled(
                extJwksUrls.map(
                    async (extJwksUrl) => (await this.getJwksByUrlAsync(extJwksUrl.trim())).keys
                )
            );
            const keysArray = [];
            const failures = [];
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    keysArray.push(result.value);
                } else {
                    failures.push({url: extJwksUrls[index], error: result.reason});
                }
            });
            if (failures.length > 0) {
                logError(
                    `Failed to fetch keys from ${failures.length} of ${extJwksUrls.length} external jwk url(s)`,
                    {
                        args: {
                            failures: failures.map((f) => ({
                                url: f.url,
                                error: f.error && f.error.message
                            }))
                        }
                    }
                );
            }
            // Only treat this as a total outage (and surface 503) when every configured
            // URL failed. If at least one provider is healthy, use the keys it returned --
            // that redundancy is the whole point of allowing multiple configured providers.
            if (failures.length === extJwksUrls.length) {
                const error = failures[0].error instanceof Error
                    ? failures[0].error
                    : new Error('Failed to fetch keys from any external jwk url');
                error.isTransient = true;
                if (!error.statusCode) {
                    error.statusCode = 503;
                }
                throw error;
            }
            return keysArray.flat(2);
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
        // A token that resolves to a completely empty scope (nothing on the JWT itself,
        // no groups, and userinfo enrichment -- if attempted -- found nothing either) is
        // authenticated but carries zero permissions; treat it as an auth failure (401),
        // not a successful login with an empty grant. Without this, such a token would
        // reach FHIR resource authorization normally and get a 403 there instead --
        // this codebase's convention (see create_without_access/remove_without_access
        // integration tests) is that a total absence of scope is 401, while a present
        // but insufficient/mismatched scope is 403.
        if (!scope) {
            logWarn('Auth rejected', {reason: 'no_scope', username, subject});
            done(null, false, {reason: 'no_scope'});
            return;
        }
        const context = {};
        if (username) {
            context.username = username;
        }
        if (subject) {
            context.subject = subject;
        }
        if (isUser) {
            context.isUser = isUser;
            const missingRequiredFields = Object.values(this.requiredJWTFields).filter(
                (field) => !jwt_payload[field]
            );
            if (missingRequiredFields.length > 0) {
                logWarn('Auth rejected', {
                    reason: 'missing_required_jwt_field',
                    missingRequiredFields,
                    username,
                    subject
                });
                done(null, false, { reason: 'missing_required_jwt_field' });
                return;
            }
            context.personIdFromJwtToken = jwt_payload[this.requiredJWTFields.clientFhirPersonId];
            context.masterPersonIdFromJwtToken = jwt_payload[this.requiredJWTFields.bwellFhirPersonId];
            context.managingOrganizationId = jwt_payload[this.optionalJWTFields.managingOrganization];

            context.subject = jwt_payload['sub'];
            context.username = context.personIdFromJwtToken;
            if (this.configManager.enableDelegatedAccessDetection && jwt_payload.act) {
                const result = this.processForDelegatedActor({ jwt_payload });
                if (result.failure) {
                    done(null, false, { reason: 'delegated_actor_failure' });
                    return;
                } else if (result.actor) {
                    context.actor = result.actor;
                    context.userType = AUTH_USER_TYPES.delegatedUser;

                    if (Array.isArray(jwt_payload.entitlements)) {
                        context.purposeOfUse = jwt_payload.entitlements;
                    }
                }
            }
            // if userType is not already set through delegated access detection,
            // accept user_type claim only when it is one of the allowed values
            if (!context.userType && this.allowedJWTUserTypes.includes(jwt_payload.user_type)) {
                context.userType = jwt_payload.user_type;
                // Initialized empty object to attach the consent policy
                context.actor = {};
                if (Array.isArray(jwt_payload.entitlements)) {
                    context.purposeOfUse = jwt_payload.entitlements;
                }
            }
        }
        if (context.userType) {
            if (!isUser) {
                logError(`userType ${context.userType} is not valid for non-patient token`, {
                    reason: 'invalid_user_type_for_non_patient_token',
                    username: context.username,
                    userType: context.userType
                });
                done(null, false, { reason: 'invalid_user_type_for_non_patient_token' });
                return;
            }
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
     * Returns true if the scope grants wildcard non-patient authority: `user/*.<x>` or
     * `access/*.<x>` where the resource-type / tenant segment is `*` (e.g. `user/*.*`, `access/*.*`,
     * `user/*.read`). These bypass tenant/access-tag filtering for non-patient resources, so they are
     * gated by trusted issuer in getFieldsFromToken. Narrowly-scoped grants (`user/Questionnaire.*`,
     * `access/walgreen.*`) and every `patient/` scope return false. See DCON-4882.
     * @param {string} scope
     * @returns {boolean}
     */
    isWildcardNonPatientScope(scope) {
        if (typeof scope !== 'string') {
            return false;
        }
        const lower = scope.toLowerCase();
        if (!lower.startsWith('user/') && !lower.startsWith('access/')) {
            return false;
        }
        const afterSlash = scope.substring(scope.indexOf('/') + 1);
        const resourceOrTenant = afterSlash.split('.')[0];
        return resourceOrTenant === '*';
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

        // Restrict wildcard non-patient authority to trusted (issuer, client_id) pairs. `access/*.*`
        // collapses to the '*' access code in scopesManager, which bypasses tenant/access-tag
        // filtering for every non-patient resource; `user/*.*` is its resource-type counterpart. A
        // single Cognito pool (issuer) can serve both a trusted internal service and an external
        // consumer app under different client_ids, so the allowlist is keyed on the pair, not the
        // issuer alone. For any token whose (iss, client_id) pair is not on the allowlist, drop only
        // these wildcard non-patient scopes so the token is confined to its patient compartment plus
        // any explicit narrow grants (e.g. user/Questionnaire.*, access/walgreen.*). No-op when the
        // allowlist is unset (unconfigured environments unchanged); patient/ scopes are never
        // touched. See DCON-4882.
        const allowedNonPatientScopeClients = this.configManager.allowedNonPatientScopeClients;
        if (
            allowedNonPatientScopeClients.size > 0 &&
            !allowedNonPatientScopeClients.has(`${jwt_payload.iss}|${clientId}`)
        ) {
            const removedScopes = scopes.filter((s) => this.isWildcardNonPatientScope(s));
            if (removedScopes.length > 0) {
                logWarn('Stripped wildcard non-patient scopes from untrusted (issuer, client_id)', {
                    reason: 'wildcard_non_patient_scope_stripped',
                    args: { iss: jwt_payload.iss, clientId, removedScopes }
                });
                scopes = scopes.filter((s) => !this.isWildcardNonPatientScope(s));
                scope = scopes.join(' ');
            }
        }

        const isUser = scopes.some((s) => s.toLowerCase().startsWith('patient/'));

        return {scope, isUser, username, subject, clientId};
    }

    /**
     * fetches the user info from the userInfo endpoint
     * @param {Object} jwt_payload
     * @param {string} token
     * @returns {Promise<UserInfo|undefined>}
     */
    async getUserInfoFromUserInfoEndpoint({ jwt_payload, token }) {
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
                // Preserve the original token's iss if the userinfo endpoint's response body doesn't
                // echo it back -- getFieldsFromToken's wildcard-non-patient-scope issuer check (see
                // isWildcardNonPatientScope, DCON-4882) needs the real issuer to avoid incorrectly
                // treating a legitimate, allowlisted issuer's token as untrusted.
                jwt_payload = { iss: jwt_payload.iss, ...userInfoResponse.body };
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
     * Extracts delegated actor information from the JWT act claim.
     * @param {Object} params
     * @param {Object} params.jwt_payload
     * @returns {{actor: import('../utils/fhirRequestInfo').JwtActor|null, failure: boolean}} Response object containing the actor information and failure status
     */
    processForDelegatedActor({ jwt_payload }) {
        const act = jwt_payload.act;
        const response = {
            actor: null,
            failure: false
        };
        // TODO: handle string act claims (future format)
        if (typeof act === 'string') {
            logInfo('Skipping act claim: string format not yet supported', { act });
            return response;
        }

        let isValidInput = true;
        // validate reference
        isValidInput &&= typeof act[this.requiredActorFields.reference] === 'string' && act[this.requiredActorFields.reference].startsWith('RelatedPerson/');
        // validate sub
        isValidInput &&= typeof act[this.requiredActorFields.sub] === 'string';

        if (!isValidInput) {
            logInfo('Invalid act claim: missing or invalid reference field or sub field', {
                reason: 'delegated_actor_failure',
                act
            });
            response.failure = true;
            return response;
        }

        response.actor = {
            reference: act[this.requiredActorFields.reference],
            sub: act[this.requiredActorFields.sub]
        };
        return response;
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
            request.jwtPayload = jwt_payload;
            if (this.cidCheckIssuer && jwt_payload.iss === this.cidCheckIssuer) {
                if (!this.cidCheckClientIds.includes(jwt_payload.cid)) {
                    logInfo(`Client ID ${jwt_payload.cid} is not allowed from issuer ${jwt_payload.iss}`, {
                        reason: 'client_id_not_allowed_for_issuer',
                        userClaim: jwt_payload.sub
                    });
                    return done(null, false, { reason: 'client_id_not_allowed_for_issuer' });
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
                        } = userInfo;
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
                    logError(`Error while fetching user info: ${error.message}`, {
                        reason: 'userinfo_endpoint_error',
                        error: error
                    });
                    // A failure to reach the userinfo endpoint is an infrastructure
                    // problem, not proof the token is invalid. Pass it through passport's
                    // done(err) signature (-> self.error() -> real error, not a fail())
                    // so it surfaces as a 503, not a 401 (INC-322).
                    error.isTransient = true;
                    if (!error.statusCode) {
                        error.statusCode = 503;
                    }
                    done(error);
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
            logWarn('Auth rejected', { reason: 'missing_jwt_payload' });
            done(null, false, { reason: 'missing_jwt_payload' });
        }
    }

}

module.exports = {
    AuthService
};
