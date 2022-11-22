/**
 * This file implements the Passport strategy that reads a JWT token and decrypts it using the public key of the OAuth Provider
 */

const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const jwksRsa = require('jwks-rsa');
const env = require('var');
const {logDebug} = require('../operations/common/logging');
const {isTrue} = require('../utils/isTrue');
const async = require('async');
const superagent = require('superagent');

/**
 * Retrieve jwks for URL
 * @param {string} jwksUrl
 * @returns {Promise<{keys:{alg:string, kid: string, n: string}[]}>}
 */
const getExternalJwksByUrlAsync = async (jwksUrl) => {
    /**
     * @type {*}
     */
    const res = await superagent.get(jwksUrl).set({
        'Accept': 'application/json'
    });
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
 * extracts the client_id and scope from the decoded token
 * @param {Object} jwt_payload
 * @param done
 * @return {*}
 */
const verify = (jwt_payload, done) => {
    if (jwt_payload) {
        /**
         * @type {boolean}
         */
        let isUser = false;
        if (jwt_payload['cognito:username']) {
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

        if (groups.length > 0) {
            scope = scope + ' ' + groups.join(' ');
        }

        // console.info(
        //     username || client_id,
        //     'Verified client_id: ' + client_id + ' username=' + username + ' scope: ' + scope
        // );

        const context = {};
        if (username) {
            context['username'] = username;
        }
        if (subject) {
            context['subject'] = subject;
        }
        if (isUser) {
            context['isUser'] = isUser;
            const fhirPatientId = jwt_payload['custom:bwell_fhir_id'];
            if (jwt_payload['custom:bwell_fhir_ids']) {
                const patientIdsFromJwtToken = jwt_payload['custom:bwell_fhir_ids'].split('|');
                if (patientIdsFromJwtToken && patientIdsFromJwtToken.length > 0) {
                    context['patientIdsFromJwtToken'] = patientIdsFromJwtToken;
                }
            } else if (fhirPatientId) {
                context['patientIdsFromJwtToken'] = [fhirPatientId];
            }
            const personIdFromJwtToken = jwt_payload['custom:bwell_fhir_person_id'];
            if (personIdFromJwtToken) {
                context['personIdFromJwtToken'] = personIdFromJwtToken;
            }
        }

        return done(null, {id: client_id, isUser}, {scope, context});
    }

    return done(null, false);
};

/* we use this to override the JwtStrategy and redirect to login
    instead of just failing and returning a 401
 */
class MyJwtStrategy extends JwtStrategy {
    constructor(options, verifyFn) {
        super(options, verifyFn);
    }

    authenticate(req, options) {
        const self = this;
        const token = self._jwtFromRequest(req);
        // can't just urlencode per https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html
        // "You can't set the value of a state parameter to a URL-encoded JSON string. To pass a string that matches
        // this format in a state parameter, encode the string to Base64, then decode it in your app.
        const resourceUrl = req.originalUrl ? Buffer.from(req.originalUrl).toString('base64') : '';
        if (
            !token &&
            req.accepts('text/html') &&
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
            logDebug({user: '', args: {message: 'Redirecting', redirect: redirectUrl}});
            return self.redirect(redirectUrl);
        }

        return super.authenticate(req, options);
    }
}

/**
 * This function is called to extract the token from the jwt cookie
 * @param {import('http').IncomingMessage} req
 * @return {{claims: {[p: string]: string|number|boolean|string[]}, scopes: string[]}|null}
 */
const cookieExtractor = function (req) {
    /**
     * @type {{claims: {[p: string]: string | number | boolean | string[]}; scopes: string[]}|null}
     */
    let token = null;
    if (req && req.accepts('text/html') && req.cookies) {
        token = req.cookies['jwt'];
        logDebug({user: '', args: {message: 'Found cookie jwt', token: token}});
    } else {
        logDebug({user: '', args: {message: 'No cookies found'}});
    }
    return token;
};

/**
 * Bearer Strategy
 *
 * This strategy will handle requests with BearerTokens.  This is only a template and should be configured to
 * your AuthZ server specifications.
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
            /**
             * @return {Promise<import('jwks-rsa').JSONWebKey[]>}
             */
            getKeysInterceptor: async () => {
                return await getExternalJwksAsync();
            },
            handleSigningKeyError: (err, cb) => {
                if (err instanceof jwksRsa.SigningKeyNotFoundError) {
                    logDebug({user: '', args: {message: 'No Signing Key found!'}});
                    return cb(new Error('No Signing Key found!'));
                }
                return cb(err);
            },
        }),
        /* specify a list of extractors and it will use the first one that returns the token */
        jwtFromRequest: ExtractJwt.fromExtractors([
            ExtractJwt.fromHeader('x-bwell-identity'),
            ExtractJwt.fromAuthHeaderAsBearerToken(),
            cookieExtractor,
            ExtractJwt.fromUrlQueryParameter('token'),
        ]),

        // Validate the audience and the issuer.
        // audience: 'urn:my-resource-server',
        // issuer: env.AUTH_ISSUER,
        algorithms: ['RS256'],
    },
    verify
);
