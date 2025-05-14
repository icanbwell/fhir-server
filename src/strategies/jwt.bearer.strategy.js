/**
 * This file implements the Passport strategy that reads a JWT token and decrypts it using the public key of the OAuth Provider
 */
const {ExtractJwt, Strategy: JwtStrategy} = require('passport-jwt');
const jwksRsa = require('jwks-rsa');
const AuthService = require('./authService');
const env = require('var');
const {logDebug, logError} = require("../operations/common/logging");
const {isTrue} = require("../utils/isTrue");
const {DEFAULT_CACHE_EXPIRY_TIME} = require("../constants");

class MyJwtStrategy extends JwtStrategy {
    /**
     * Constructor for the JWT strategy
     * @param {Object} options
     * @param {AuthService} authService
     */
    constructor({authService, options}) {
        super(
            {
                ...options,
                secretOrKeyProvider: jwksRsa.passportJwtSecret({
                    cache: true,
                    rateLimit: true,
                    jwksRequestsPerMinute: 5,
                    jwksUri: env.AUTH_JWKS_URL,
                    cacheMaxAge: env.CACHE_EXPIRY_TIME ? Number(env.CACHE_EXPIRY_TIME) : DEFAULT_CACHE_EXPIRY_TIME,
                    fetcher: (jwksUrl) => authService.getJwksByUrlAsync(jwksUrl),
                    getKeysInterceptor: async () => {
                        return await authService.getExternalJwksAsync();
                    },
                    handleSigningKeyError: (err, cb) => {
                        if (err instanceof jwksRsa.SigningKeyNotFoundError) {
                            logDebug('No Signing Key found!', { user: '' });
                            return cb(new Error('No Signing Key found!'));
                        }
                        return cb(err);
                    }
                }),
                jwtFromRequest: ExtractJwt.fromExtractors([
                    ExtractJwt.fromAuthHeaderAsBearerToken(),
                    (req) => authService.cookieExtractor(req),
                    ExtractJwt.fromUrlQueryParameter('token')
                ]),
                passReqToCallback: true
            },
            (_request, jwt_payload, done) => authService.verify(_request, jwt_payload, done)
        );
    }

    authenticate(req, options) {
        const token = this._jwtFromRequest(req);
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
            const redirectUrl = `${env.AUTH_CODE_FLOW_URL}/login?` +
                `response_type=code&client_id=${env.AUTH_CODE_FLOW_CLIENT_ID}` +
                `&redirect_uri=${httpProtocol}://${req.headers.host}/authcallback&state=${resourceUrl}`;
            logDebug('Redirecting', { user: '', args: { redirect: redirectUrl } });
            return this.redirect(redirectUrl);
        }

        return super.authenticate(req, options);
    }

    // noinspection JSUnusedGlobalSymbols
    fail(jwt_err) {
        logError(`JWT error`, { user: '', args: { jwt_err } });
        super.fail(jwt_err);
    }
}

module.exports = {
    MyJwtStrategy
};
