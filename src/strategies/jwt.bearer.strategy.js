/**
 * This file implements the Passport strategy that reads a JWT token and decrypts it using the public key of the OAuth Provider
 */
const {ExtractJwt, Strategy: JwtStrategy} = require('passport-jwt');
const jwksRsa = require('jwks-rsa');
const {AuthService} = require('./authService');
const {logDebug, logError} = require("../operations/common/logging");
const {isTrue} = require("../utils/isTrue");
const {DEFAULT_CACHE_EXPIRY_TIME} = require("../constants");
const {assertTypeEquals} = require("../utils/assertType");
const {ConfigManager} = require("../utils/configManager");

class MyJwtStrategy extends JwtStrategy {
    /**
     * Constructor for the JWT strategy
     * @param {Object} [options]
     * @param {AuthService} authService
     * @param {ConfigManager} configManager
     */
    constructor({authService, configManager, options = {}}) {
        assertTypeEquals(authService, AuthService);

        assertTypeEquals(configManager, ConfigManager);
        super(
            {
                ...options,
                secretOrKeyProvider: jwksRsa.passportJwtSecret({
                    cache: true,
                    rateLimit: true,
                    jwksRequestsPerMinute: 5,
                    jwksUri: configManager.authJwksUrl,
                    cacheMaxAge: configManager.cacheExpiryTime,
                    fetcher: (jwksUrl) => authService.getJwksByUrlAsync(jwksUrl),
                    getKeysInterceptor: async () => {
                        return await authService.getExternalJwksAsync();
                    },
                    handleSigningKeyError: (err, cb) => {
                        if (err instanceof jwksRsa.SigningKeyNotFoundError) {
                            logDebug('No Signing Key found!', {user: ''});
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

    /**
     * This method is called when the JWT token is extracted from the request
     * @param {import('http').IncomingMessage} req
     * @param {Object} options
     * @returns {*}
     */
    authenticate(req, options) {
        const self = this;
        const token = this._jwtFromRequest(req);

        // if (!token) {
        //     return self.fail(new Error('No auth token'));
        // }

        return super.authenticate(req, options);
    }

    // noinspection JSUnusedGlobalSymbols
    // fail(jwt_err) {
    //     logError(`JWT error`, {user: '', args: {jwt_err}});
    // }
}


module.exports = {
    MyJwtStrategy
};
