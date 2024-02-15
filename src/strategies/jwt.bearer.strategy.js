/**
 * This file implements the Passport strategy that reads a JWT token and decrypts it using the public key of the OAuth Provider
 */

const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const jwksRsa = require('jwks-rsa');
const env = require('var');
const { logDebug, logError } = require('../operations/common/logging');
const { isTrue } = require('../utils/isTrue');
const async = require('async');
const superagent = require('superagent');
const { Issuer } = require('openid-client');
const { EXTERNAL_REQUEST_RETRY_COUNT, DEFAULT_CACHE_EXPIRY_TIME } = require('../constants');
const requestTimeout = (parseInt(env.EXTERNAL_REQUEST_TIMEOUT_SEC) || 30) * 1000;

const requiredJWTFields = [
    // 'custom:clientFhirPersonId',
    // 'custom:clientFhirPatientId',
    'custom:bwellFhirPersonId'
    // 'custom:bwellFhirPatientId',
];

/**
 * Retrieve jwks for URL
 * @param {string} jwksUrl
 * @returns {Promise<import('jwks-rsa').JSONWebKey[]>}
 */
const getExternalJwksByUrlAsync = async (jwksUrl) => {
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
    return jsonResponse.keys;
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
            async (extJwksUrl) => await getExternalJwksByUrlAsync(extJwksUrl.trim())
        );
        return keysArray.flat(2);
    }

    return [];
};

/**
 * Gets or creates an OpenID client issuer
 * @return {Promise<import('openid-client').Issuer<import('openid-client').BaseClient>>}
 */
const getOrCreateOpenIdClientIssuerAsync = async (iss) => {
    return await Issuer.discover(iss);
};

/**
 * Gets user info from OpenID Connect provider
 * @param {string} accessToken
 * @return {Promise<import('openid-client').UserinfoResponse<Object | undefined, import('openid-client').UnknownObject>|undefined>}
 */
const getUserInfoAsync = async (accessToken, iss, clientId) => {
    const issuer = await getOrCreateOpenIdClientIssuerAsync(iss);

    /**
     * @type {import('openid-client').BaseClient}
     */
    const client = new issuer.Client({
        client_id: clientId
    }); // => Client

    return await client.userinfo(accessToken);
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
        token = req.cookies['jwt'];
        logDebug('Found cookie jwt', { user: '', args: { token: token } });
    } else {
        logDebug('No cookies found', { user: '' });
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
function parseUserInfoFromPayload ({ username, subject, isUser, jwt_payload, done, client_id, scope }) {
    const context = {};
    if (username) {
        context['username'] = username;
    }
    if (subject) {
        context['subject'] = subject;
    }
    if (isUser) {
        context['isUser'] = isUser;
        // Test that required fields are populated
        let validInput = true;
        requiredJWTFields.forEach((field) => {
            if (!jwt_payload[`${field}`]) {
                logDebug(`Error: ${field} field is missing`, { user: '' });
                validInput = false;
            }
        });
        if (!validInput) {
            return done(null, false);
        }
        const fhirPatientId = jwt_payload['custom:bwell_fhir_id'];
        if (jwt_payload['custom:bwell_fhir_ids']) {
            const patientIdsFromJwtToken = jwt_payload['custom:bwell_fhir_ids'].split('|');
            if (patientIdsFromJwtToken && patientIdsFromJwtToken.length > 0) {
                context['patientIdsFromJwtToken'] = patientIdsFromJwtToken;
            }
        } else if (fhirPatientId) {
            context['patientIdsFromJwtToken'] = [fhirPatientId];
        }
        context['personIdFromJwtToken'] = jwt_payload['custom:bwellFhirPersonId'];
    }

    return done(null, { id: client_id, isUser, name: username, username: username }, { scope, context });
}

// noinspection OverlyComplexFunctionJS,FunctionTooLongJS
/**
 * extracts the client_id and scope from the decoded token
 * @param {import('http').IncomingMessage} request
 * @param {Object} jwt_payload
 * @param {requestCallback} done
 * @return {*}
 */
const verify = (request, jwt_payload, done) => {
    if (jwt_payload) {
        /**
         * @type {boolean}
         */
        let isUser = false;
        if (jwt_payload['cognito:username'] || jwt_payload['custom:bwellFhirPersonId']) {
            isUser = true;
        }
        const client_id = jwt_payload.client_id ? jwt_payload.client_id : jwt_payload[env.AUTH_CUSTOM_CLIENT_ID];
        /**
         * @type {string}
         */
        let scope = jwt_payload.scope ? jwt_payload.scope : jwt_payload[env.AUTH_CUSTOM_SCOPE];
        /**
         * @type {string[]}
         */
        const groups = jwt_payload[env.AUTH_CUSTOM_GROUP] ? jwt_payload[env.AUTH_CUSTOM_GROUP] : '';

        /**
         * @type {string}
         */
        const username = jwt_payload.username ? jwt_payload.username : jwt_payload['cognito:username'];

        /**
         * @type {string}
         */
        const subject = jwt_payload.subject ? jwt_payload.subject : jwt_payload[env.AUTH_CUSTOM_SUBJECT];

        /**
         * @type {string}
         */
        const tokenUse = jwt_payload.token_use ? jwt_payload.token_use : null;

        if (groups.length > 0) {
            scope = scope ? scope + ' ' + groups.join(' ') : groups.join(' ');
        }

        // see if there is a patient scope and no user scope
        /**
         * @type {string[]}
         */
        const scopes = scope ? scope.split(' ') : [];
        if (
            scopes.some(s => s.toLowerCase().startsWith('patient/')) &&
            scopes.some(s => s.toLowerCase().startsWith('openid')) &&
            scopes.every(s => !s.toLowerCase().startsWith('user/')) &&
            tokenUse === 'access'
        ) {
            // we were passed an access token for a user and now need to get the user's info from our
            // OpenID Connect provider
            isUser = true;
            const authorizationHeader = request.header('Authorization');
            // get token from either the request or the cookie
            const accessToken = authorizationHeader ? authorizationHeader.split(' ').pop() : cookieExtractor(request);
            if (accessToken) {
                return getUserInfoAsync(accessToken, jwt_payload.iss, client_id).then(
                    (id_token_payload) => {
                        return parseUserInfoFromPayload(
                            {
                                username, subject, isUser, jwt_payload: id_token_payload, done, client_id, scope
                            }
                        );
                    }
                ).catch(error => {
                    logError('Error in parsing token for patient scope', error);
                    return done(null, false);
                });
            }
        } else {
            return parseUserInfoFromPayload(
                {
                    username, subject, isUser, jwt_payload, done, client_id, scope
                }
            );
        }
    }

    return done(null, false);
};

/**
 * @classdesc we use this to override the JwtStrategy and redirect to login
 *     instead of just failing and returning a 401
 *     https://www.passportjs.org/packages/passport-jwt/
 */
class MyJwtStrategy extends JwtStrategy {
    authenticate (req, options) {
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
            logDebug('Redirecting', { user: '', args: { redirect: redirectUrl } });
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
module.exports.strategy = new MyJwtStrategy(
    {
        // Dynamically provide a signing key based on the kid in the header and the signing keys provided by the JWKS endpoint.
        secretOrKeyProvider: jwksRsa.passportJwtSecret({
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 5,
            jwksUri: env.AUTH_JWKS_URL,
            cacheMaxAge: env.CACHE_EXPIRY_TIME ? Number(env.CACHE_EXPIRY_TIME) : DEFAULT_CACHE_EXPIRY_TIME,
            /**
             * @return {Promise<import('jwks-rsa').JSONWebKey[]>}
             */
            getKeysInterceptor: async () => {
                return await getExternalJwksAsync();
            },
            handleSigningKeyError: (err, cb) => {
                if (err instanceof jwksRsa.SigningKeyNotFoundError) {
                    logDebug('No Signing Key found!', { user: '' });
                    return cb(new Error('No Signing Key found!'));
                }
                return cb(err);
            }
        }),
        /* specify a list of extractors and it will use the first one that returns the token */
        jwtFromRequest: ExtractJwt.fromExtractors([
            ExtractJwt.fromHeader('x-bwell-identity'),
            ExtractJwt.fromAuthHeaderAsBearerToken(),
            cookieExtractor,
            ExtractJwt.fromUrlQueryParameter('token')
        ]),

        // Validate the audience and the issuer.
        // audience: 'urn:my-resource-server',
        // issuer: env.AUTH_ISSUER,
        algorithms: ['RS256'],
        // pass request to verify callback
        passReqToCallback: true
    },
    verify
);
