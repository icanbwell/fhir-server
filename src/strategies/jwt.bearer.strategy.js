/**
 * This file implements the Passport strategy that reads a JWT token and decrypts it using the public key of the OAuth Provider
 */
const {ExtractJwt, Strategy: JwtStrategy} = require('passport-jwt');
const jwksRsa = require('jwks-rsa');
const {AuthService} = require('./authService');
const {logError} = require("../operations/common/logging");
const {assertTypeEquals} = require("../utils/assertType");
const {ConfigManager} = require("../utils/configManager");
const { JWKS_REQUESTS_PER_MINUTE, JWT_EXPIRY_CLOCK_TOLERANCE } = require('../constants');

class MyJwtStrategy extends JwtStrategy {
    /**
     * Constructor for the JWT strategy
     * @typedef {Object} MyJwtStrategyOptions
     * @property {Object} [options]
     * @property {AuthService} authService
     * @property {ConfigManager} configManager
     *
     * @param {MyJwtStrategyOptions} options
     */
    constructor({authService, configManager, options = {}}) {
        assertTypeEquals(authService, AuthService);

        assertTypeEquals(configManager, ConfigManager);
        super(
            {
                ...options,
                jsonWebTokenOptions: {
                    clockTolerance: JWT_EXPIRY_CLOCK_TOLERANCE
                },
                secretOrKeyProvider: jwksRsa.passportJwtSecret({
                    cache: true,
                    rateLimit: true,
                    jwksRequestsPerMinute: JWKS_REQUESTS_PER_MINUTE,
                    jwksUri: configManager.authJwksUrl,
                    cacheMaxAge: configManager.cacheExpiryTime,
                    fetcher: (jwksUrl) => authService.getJwksByUrlAsync(jwksUrl),
                    getKeysInterceptor: async () => {
                        return await authService.getExternalJwksAsync();
                    },
                    handleSigningKeyError: (err, cb) => {
                        if (err instanceof jwksRsa.SigningKeyNotFoundError) {
                            logError('JWKS signing key not found', {
                                user: '',
                                args: {error: err.message}
                            });
                            return cb(new Error('No Signing Key found!'));
                        }
                        logError('JWKS signing key error', {
                            user: '',
                            args: {error: err.message, type: err.name}
                        });
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
            (request, jwt_payload, done) => authService.verify({
                    request,
                    jwt_payload,
                    token: this._jwtFromRequest(request),
                    done
                }
            )
        );
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
    }
}


module.exports = {
    MyJwtStrategy
};
