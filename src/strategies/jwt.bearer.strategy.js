/**
 * This file implements the Passport strategy that reads a JWT token and decrypts it using the public key of the OAuth Provider
 */

const {ExtractJwt, Strategy: JwtStrategy} = require('passport-jwt');
const async = require('async');
const env = require('var');
const jwksRsa = require('jwks-rsa');
const superagent = require('superagent');
const LRUCache = require('lru-cache');

const {
    EXTERNAL_REQUEST_RETRY_COUNT,
    DEFAULT_CACHE_EXPIRY_TIME,
    DEFAULT_CACHE_MAX_COUNT
} = require('../constants');
const {isTrue} = require('../utils/isTrue');
const {logDebug, logError} = require('../operations/common/logging');
const requestTimeout = (parseInt(env.EXTERNAL_REQUEST_TIMEOUT_SEC) || 30) * 1000;

const requiredJWTFields = {
    clientFhirPersonId: 'clientFhirPersonId',
    clientFhirPatientId: 'clientFhirPatientId',
    bwellFhirPersonId: 'bwellFhirPersonId',
    bwellFhirPatientId: 'bwellFhirPatientId'
};

const cacheOptions = {
    max: env.CACHE_MAX_COUNT ? Number(env.CACHE_MAX_COUNT) : DEFAULT_CACHE_MAX_COUNT,
    ttl: env.CACHE_EXPIRY_TIME ? Number(env.CACHE_EXPIRY_TIME) : DEFAULT_CACHE_EXPIRY_TIME
};
const cache = new LRUCache(cacheOptions);

/**
 * Retrieve jwks for URL
 * @param {string} jwksUrl
 * @returns {Promise<import('jwks-rsa').JSONWebKey[]>}
 */
const getJwksByUrlAsync = async (jwksUrl) => {
    if (cache.has(jwksUrl)) {
        return cache.get(jwksUrl)
    }
    try {
        /**
         * @type {*}
         */
        const res = await superagent
            .get(jwksUrl)
            .set({
                Accept: 'application/json'
            })
            .retry(EXTERNAL_REQUEST_RETRY_COUNT)
            .timeout(requestTimeout);
        /**
         * @type {Object}
         */
        const jsonResponse = JSON.parse(res.text);
        cache.set(jwksUrl, jsonResponse);
        return jsonResponse;
    } catch (error) {
        logError(`Error while fetching keys from external jwk url: ${error.message}`, {
            error: error,
            args: {
                jwksUrl: jwksUrl
            }
        });
        return {keys: []};
    }
};

/**
 * Retrieve jwks from external IDPs
 * @returns {Promise<import('jwks-rsa').JSONWebKey[]>}
 */
const getExternalJwksAsync = async () => {
    if (env.EXTERNAL_AUTH_JWKS_URLS.length > 0) {
        /**
         * @type {string[]}
         */
        const extJwksUrls = env.EXTERNAL_AUTH_JWKS_URLS.split(',');

        // noinspection UnnecessaryLocalVariableJS
        /**
         * @type {import('jwks-rsa').JSONWebKey[][]}
         */
        const keysArray = await async.map(
            extJwksUrls,
            async (extJwksUrl) => (await getJwksByUrlAsync(extJwksUrl.trim())).keys
        );
        return keysArray.flat(2);
    }

    return [];
};

/**
 * This function is called to extract the token from the jwt cookie
 * @param {import('http').IncomingMessage} req
 * @return {{claims: {[p: string]: string|number|boolean|string[]}, scopes: string[]}|null}
 */
const cookieExtractor = function (req) {
    /**
     * @type {string|null}
     */
    let token = null;
    if (req && req.cookies) {
        token = req.cookies.jwt;
        logDebug('Found cookie jwt', {user: '', args: {token}});
    } else {
        logDebug('No cookies found', {user: ''});
    }
    return token;
};

/**
 * This callback type is called `requestCallback` and is displayed as a global symbol.
 *
 * @callback requestCallback
 * @param {Object} user
 * @param {Object} info
 * @param {Object} [details]
 */

/**
 * parses user info from payload
 * @param {string} username
 * @param {string} subject
 * @param {boolean} isUser
 * @param {Object} jwt_payload
 * @param {requestCallback} done
 * @param {string} client_id
 * @param {string|null} scope
 * @return {Object}
 */
function parseUserInfoFromPayload({username, subject, isUser, jwt_payload, done, client_id, scope}) {
    const context = {};
    if (username) {
        context.username = username;
    }
    if (subject) {
        context.subject = subject;
    }
    if (isUser) {
        context.isUser = isUser;
        // Test that required fields are populated
        let validInput = true;
        Object.values(requiredJWTFields).forEach((field) => {
            if (!jwt_payload[field]) {
                logDebug(`Error: ${field} field is missing`, {user: ''});
                validInput = false;
            }
        });
        if (!validInput) {
            return done(null, false);
        }
        context.personIdFromJwtToken = jwt_payload[requiredJWTFields.clientFhirPersonId];
    }

    logDebug(`JWT payload`, {user: '', args: {jwt_payload}});

    return done(null, {id: client_id, isUser, name: username, username}, {scope, context});
}

/**
 * This function is called to extract the properties with name in propertyNames from the jwt payload
 * @param {Object} jwt_payload
 * @param {string[]|undefined|string} propertyNames
 * @return {string[]}
 */
const getPropertiesFromPayload = ({jwt_payload, propertyNames}) => {
    if (propertyNames && typeof propertyNames === 'string') {
        propertyNames = propertyNames.split(',');
    }
    if (propertyNames && propertyNames.length > 0) {
        return propertyNames.map((propertyName) => {
            if (jwt_payload[propertyName]) {
                // if the payload is an array, we need to join it
                // if the payload is a string, we need to return it as is
                return Array.isArray(jwt_payload[propertyName]) ?
                    jwt_payload[propertyName].join(' ') :
                    jwt_payload[propertyName];
            }
            return null;
        }).filter((property) => property !== null);
    }
    return [];
};

/**
 * This function is called to extract the first property with a name in propertyNames from the jwt payload
 * @param {Object} jwt_payload
 * @param {string[]|undefined|string} propertyNames
 * @return {string|null}
 */
const getFirstPropertyFromPayload = ({jwt_payload, propertyNames}) => {
    if (propertyNames && typeof propertyNames === 'string') {
        propertyNames = propertyNames.split(',');
    }
    if (propertyNames && propertyNames.length > 0) {
        for (const propertyName of propertyNames) {
            if (jwt_payload[propertyName]) {
                // if the payload is an array, we need to join it
                // if the payload is a string, we need to return it as is
                return Array.isArray(jwt_payload[propertyName]) ?
                    jwt_payload[propertyName].join(' ') :
                    jwt_payload[propertyName];
            }
        }
    }
    return null;
};

// noinspection OverlyComplexFunctionJS,FunctionTooLongJS
/**
 * extracts the client_id and scope from the decoded token
 * @param {import('http').IncomingMessage} _request
 * @param {Object} jwt_payload
 * @param {requestCallback} done
 * @return {*}
 */
const verify = (_request, jwt_payload, done) => {
    if (jwt_payload) {
        // Case when provided token is not access token
        // if (jwt_payload.token_use !== 'access') {
        //     return done(null, false);
        // }
        logDebug(`JWT payload`, {user: '', args: {jwt_payload}});

        // Calculate scopes from jwt_payload
        /**
         * @type {string}
         */
        let scope = jwt_payload.scope ? jwt_payload.scope : getPropertiesFromPayload(
            {
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_SCOPE
            }
        ).join(' ');

        /**
         * @type {string[]}
         */
        const groups = getPropertiesFromPayload(
            {
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_GROUP
            }
        );
        logDebug(`JWT groups`, {user: '', args: {groups}});

        if (groups.length > 0) {
            scope = scope ? scope + ' ' + groups.join(' ') : groups.join(' ');
        }

        /**
         * @type {string[]}
         */
        const scopes = scope ? scope.split(' ') : [];

        /**
         * If the patient scope is present, it indicates that the request is coming from a user
         * @type {boolean}
         */
        const isUser = scopes.some(s => s.toLowerCase().startsWith('patient/'));

        const result = {
            username: jwt_payload.username ? jwt_payload.username : getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_USERNAME
            }),
            subject: jwt_payload.subject ? jwt_payload.subject : getFirstPropertyFromPayload({
                jwt_payload,
                propertyNames: env.AUTH_CUSTOM_SUBJECT
            }),
            isUser,
            jwt_payload,
            done,
            client_id: jwt_payload.client_id ? jwt_payload.client_id : getFirstPropertyFromPayload(
                {
                    jwt_payload,
                    propertyNames: env.AUTH_CUSTOM_CLIENT_ID
                }
            ),
            scope
        };
        logDebug(`JWT result`, {user: '', args: {result}});
        return parseUserInfoFromPayload(result);
    }

    return done(null, false);
};

/**
 * @classdesc we use this to override the JwtStrategy and redirect to login
 *     instead of just failing and returning a 401
 *     https://www.passportjs.org/packages/passport-jwt/
 */
class MyJwtStrategy extends JwtStrategy {
    authenticate(req, options) {
        const self = this;
        const token = self._jwtFromRequest(req);
        // can't just urlencode per https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html
        // "You can't set the value of a state parameter to a URL-encoded JSON string. To pass a string that matches
        // this format in a state parameter, encode the string to Base64, then decode it in your app.
        const resourceUrl = req.originalUrl ? Buffer.from(req.originalUrl).toString('base64') : '';
        if (
            !token &&
            req.useragent &&
            req.useragent.isDesktop &&
            isTrue(env.REDIRECT_TO_LOGIN) &&
            (req.method === 'GET' ||
                (req.method === 'POST' && resourceUrl && resourceUrl.includes('_search')))
        ) {
            const httpProtocol = env.ENVIRONMENT === 'local' ? 'http' : 'https';
            // state parameter determines the url that Cognito redirects to: https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html
            const redirectUrl = `${env.AUTH_CODE_FLOW_URL}/login?` +
                `response_type=code&client_id=${env.AUTH_CODE_FLOW_CLIENT_ID}` +
                `&redirect_uri=${httpProtocol}://${req.headers.host}/authcallback&state=${resourceUrl}`;
            logDebug('Redirecting', {user: '', args: {redirect: redirectUrl}});
            return self.redirect(redirectUrl);
        }

        return super.authenticate(req, options);
    }
}

/**
 * Bearer Strategy
 *
 * This strategy will handle requests with BearerTokens.
 *
 * Requires ENV variables for introspecting the token
 */
const strategy = new MyJwtStrategy(
    {
        // Dynamically provide a signing key based on the kid in the header and the signing keys provided by the JWKS endpoint.
        secretOrKeyProvider: jwksRsa.passportJwtSecret({
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 5,
            jwksUri: env.AUTH_JWKS_URL,
            cacheMaxAge: env.CACHE_EXPIRY_TIME ? Number(env.CACHE_EXPIRY_TIME) : DEFAULT_CACHE_EXPIRY_TIME,
            fetcher: getJwksByUrlAsync,
            /**
             * @return {Promise<import('jwks-rsa').JSONWebKey[]>}
             */
            getKeysInterceptor: async () => {
                return await getExternalJwksAsync();
            },
            handleSigningKeyError: (err, cb) => {
                if (err instanceof jwksRsa.SigningKeyNotFoundError) {
                    logDebug('No Signing Key found!', {user: ''});
                    return cb(new Error('No Signing Key found!'));
                }
                return cb(err);
            }
        }),
        /* specify a list of extractors and it will use the first one that returns the token */
        jwtFromRequest: ExtractJwt.fromExtractors([
            ExtractJwt.fromAuthHeaderAsBearerToken(),
            cookieExtractor,
            ExtractJwt.fromUrlQueryParameter('token')
        ]),

        // Validate the audience and the issuer.
        // audience: 'urn:my-resource-server',
        algorithms: ['RS256'],
        // pass request to verify callback
        passReqToCallback: true
    },
    verify
);

module.exports = {
    getExternalJwksAsync,
    getJwksByUrlAsync,
    strategy
};
