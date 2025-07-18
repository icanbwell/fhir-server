/**
 * This route handler implement the fhir server route.  It inherits from the base FHIR Server and makes some changes
 */

const compression = require('compression');
const { isTrue } = require('../utils/isTrue');
const {
    resolveSchema,
    isValidVersion
} = require('../middleware/fhir/utils/schema.utils');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const helmet = require('helmet');
const express = require('express');
const { FhirRouter } = require('../middleware/fhir/router');
const { assertTypeEquals } = require('../utils/assertType');
const passport = require('passport');
const path = require('path');
const contentType = require('content-type');
const httpContext = require('express-http-context');
const { REQUEST_ID_TYPE } = require('../constants');
const { convertErrorToOperationOutcome } = require('../utils/convertErrorToOperationOutcome');
const { ConfigManager } = require('../utils/configManager');
const {MyJwtStrategy} = require("../strategies/jwt.bearer.strategy");

class MyFHIRServer {
    /**
     * constructor
     * @param {function (): SimpleContainer} fnGetContainer
     * @param {Object} config
     * @param {import('express').Express} app
     */
    constructor (fnGetContainer, config = {}, app = null) {
        this.config = config;
        // validate(this.config); // TODO: REMOVE: logger in future versions, emit notices for now
        /**
         * @type {import('express').Express}
         */
        this.app = app || express(); // Setup some environment variables handy for setup

        /**
         * @type {SimpleContainer}
         */
        this.container = fnGetContainer();

        /**
         * @type {FhirRouter}
         */
        this.fhirRouter = this.container.fhirRouter;
        assertTypeEquals(this.fhirRouter, FhirRouter);

        /**
         * @type {ConfigManager}
         */
        this.configManager = this.container.configManager;
        assertTypeEquals(this.configManager, ConfigManager);

        const { server = {} } = this.config;
        this.env = {
            USE_HTTPS: server.ssl && server.ssl.key && server.ssl.cert ? server.ssl : undefined
        };

        // return self for chaining
        return this;
    }

    /**
     * Configures middleware
     * @return {MyFHIRServer}
     */
    configureMiddleware () {
        this.app.use(
            compression({
                // https://www.npmjs.com/package/compression
                level: 9,
                filter: (req, _) => {
                    if (req.headers['x-no-compression']) {
                        // don't compress responses with this request header
                        return false;
                    }
                    // compress everything
                    return !isTrue(process.env.DISABLE_COMPRESSION);
                }
            })
        );

        const allowedContentTypes = ['application/fhir+json', 'application/json+fhir', 'application/json-patch+json', 'application/fhir+ndjson'];

        this.app.use((req, res, next) => {
            const ct = req.headers['content-type'] || '';
            if (ct.includes('application/fhir+ndjson')) {
                return next(); // skip parsing
            }
            return express.json({ type: allowedContentTypes,
                limit: this.configManager.payloadLimit })(req, res, next); // parse JSON
        });



        // reject any requests that don't have correct content type
        this.app.use((req, res, next) => {
            // if methods are for GET or DELETE then no need to check content-type
            if (req.method && (req.method.toLowerCase() === 'get' || req.method.toLowerCase() === 'delete')) {
                next();
                return;
            }
            try {
                // http://www.hl7.org/implement/standards/fhir/http.html#mime-type
                // http://www.hl7.org/implement/standards/fhir/http.html#summary
                /**
                 * @type {import('content-type').ContentType}
                 */
                const contentTypeHeader = contentType.parse(req.headers['content-type']);
                if (allowedContentTypes.includes(contentTypeHeader.type) ||
                    contentTypeHeader.type === 'application/x-www-form-urlencoded') {
                    next();
                } else {
                    return res.status(400).json(
                        {
                            message: `Content Type ${req.headers['content-type']} is not supported. ` +
                                `Please use one of: ${allowedContentTypes.join(',')}`
                        }
                    );
                }
            } catch (e) {
                return res.status(400).json(
                    {
                        message: `Content Type ${req.headers['content-type']} is not supported. ` +
                            `Please use one of: ${allowedContentTypes.join(',')}`
                    }
                );
            }
        });

        // Enable the body parser
        this.app.use(
            express.urlencoded({
                extended: true,
                limit: this.configManager.payloadLimit,
                parameterLimit: 50000
            })
        );
        // this.app.use(
        //     express.json({
        //         type: allowedContentTypes,
        //         limit: this.configManager.payloadLimit
        //     })
        // );

        // add container to request
        // this.app.use((/** @type {import('http').IncomingMessage} **/ req, /** @type {import('http').ServerResponse} **/ res, next) => {
        //     req.container = this.fnCreateContainer();
        //     next();
        // });
        return this;
    }

    /**
     * Configures Helmet for security
     * @param [helmetConfig]
     * @return {MyFHIRServer}
     */
    configureHelmet (helmetConfig) {
        /**
         * The following headers are turned on by default:
         * - dnsPrefetchControl (Control browser DNS prefetching). https://helmetjs.github.io/docs/dns-prefetch-control
         * - frameguard (prevent clickjacking). https://helmetjs.github.io/docs/frameguard
         * - hidePoweredBy (remove the X-Powered-By header). https://helmetjs.github.io/docs/hide-powered-by
         * - hsts (HTTP strict transport security). https://helmetjs.github.io/docs/hsts
         * - ieNoOpen (sets X-Download-Options for IE8+). https://helmetjs.github.io/docs/ienoopen
         * - noSniff (prevent clients from sniffing MIME type). https://helmetjs.github.io/docs/dont-sniff-mimetype
         * - xssFilter (adds small XSS protections). https://helmetjs.github.io/docs/xss-filter/
         */
        this.app.use(
            helmet(
                helmetConfig || {
                    // Needs https running first
                    hsts: this.env.USE_HTTPS
                    // crossOriginResourcePolicy: false,
                }
            )
        );

        // return self for chaining
        return this;
    } // Configure session

    /**
     * Configures with the session
     * @param {Object|undefined} [session]
     * @return {MyFHIRServer}
     */
    configureSession (session) {
        // Session config can come from the core config as well, let's handle both cases
        const { server = {} } = this.config; // If a session was passed in the config, let's use it

        if (session || server.sessionStore) {
            this.app.use(session || server.sessionStore);
        } // return self for chaining

        return this;
    }

    // configureAuthorization() {
    //     // return self for chaining
    //     return this;
    // }

    // configurePassport() {
    //     return super.configurePassport();
    // }

    configurePassport () {
        if (this.config.auth) {
            passport.use('jwt', this.container.jwt_strategy);
        }

        return this;
    }

    /**
     * Set up a public directory for static assets
     * @param {string} publicDirectory
     * @return {MyFHIRServer}
     */
    setPublicDirectory (publicDirectory = '') {
        // Public config can come from the core config as well, let's handle both cases
        const { server = {} } = this.config;

        if (publicDirectory || server.publicDirectory) {
            this.app.use(express.static(publicDirectory || server.publicDirectory));
        } // return self for chaining

        return this;
    }

    // configureLoggers(fun) {
    //     fun(loggers.container, loggers.transports); // return self for chaining
    //
    //     return this;
    // }

    /**
     * Sets up routes to catch and show errors
     * @return {MyFHIRServer}
     */
    setErrorRoutes () {
        /**
         * @type {import('winston').logger}
         */
        // Enable error tracking error handler if supplied in config
        if (this.config.errorTracking && this.config.errorTracking.errorHandler) {
            this.config.errorTracking.errorHandler(this.app);
        }

        // Generic catch all error handler
        // Errors should be thrown with next and passed through
        // noinspection JSValidateTypes
        this.app.use(
            (
                /** @type {import('express').ErrorRequestHandler} */ err,
                /** @type {import('express').Request} */ req,
                /** @type {import('express').Response} */ res,
                /** @type {import('express').NextFunction} */ next
            ) => {
                // noinspection JSValidateTypes
                /**
                 * This is needed otherwise PyCharm thinks res is the NextFunction
                 * @type {import('express').Response}
                 */
                const res1 = res;
                // get base from URL instead of params since it might not be forwarded
                const base = req.url.split('/')[1];
                const isValidBaseVersion = isValidVersion(base);
                if (!isValidBaseVersion) {
                    res1.status(404);
                    res1.json({}).end();
                    return;
                }
                try {
                    // Get an operation outcome for this instance
                    const OperationOutcome = resolveSchema(
                        isValidBaseVersion ? base : VERSIONS['4_0_0'],
                        'operationoutcome'
                    );
                    if (res.headersSent) {
                        // usually means we are streaming data so can't change headers
                        // next();
                        res1.end();
                    } else {
                        if (req.id && !res.headersSent) {
                            res1.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
                        }
                        // If there is an error and it is an OperationOutcome
                        if (err && err.resourceType === OperationOutcome.resourceType) {
                            let errorToSend = err;
                            const status = err.statusCode || 500;

                            if (status === 500) {
                                errorToSend = convertErrorToOperationOutcome({ error: err, internalError: true });
                            }
                            res1.status(status).json(errorToSend);
                        } else if (err) {
                            const status = err.statusCode || 500;
                            /**
                             * @type {OperationOutcome}
                             */
                            const operationOutcome = convertErrorToOperationOutcome({
                                error: err,
                                internalError: status === 500
                            });
                            res1.status(status).json(operationOutcome);
                        } else {
                            next();
                        }
                    }
                } catch (e) {
                    // logger.error(e);
                    // Get an operation outcome for this instance
                    const OperationOutcome = resolveSchema(
                        isValidBaseVersion ? base : VERSIONS['4_0_1'],
                        'operationoutcome'
                    );
                    res1.status(500).json(new OperationOutcome({
                        issue: [
                            {
                                severity: 'error',
                                code: 'exception',
                                diagnostics: e.toString() + ' | ' + e.stack
                            }
                        ]
                    }));
                }
            }
        );

        // Nothing has responded by now, respond with 404
        this.app.use((req, res) => {
            // get base from URL instead of params since it might not be forwarded
            const base = req.url.split('/')[1] || VERSIONS['4_0_1'];

            let OperationOutcome;
            if (Object.keys(VERSIONS).includes(base)) {
                OperationOutcome = resolveSchema(base, 'operationoutcome');
            } else {
                // if it's a misplaced URL, just return an R4 OperationOutcome
                OperationOutcome = resolveSchema('4_0_0', 'operationoutcome');
            }

            // Get an operation outcome for this instance
            const error = new OperationOutcome({
                issue: [
                    {
                        severity: 'error',
                        code: 'not-found',
                        details: {
                            text: `Invalid url: ${req.path}`
                        }
                    }
                ]
            });
            if (req.id && !res.headersSent) {
                res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
            }
            res.status(404).json(error);
        });

        // return self for chaining
        return this;
    }

    /**
     * Sets routes for all the operations
     * @return {MyFHIRServer}
     */
    setProfileRoutes () {
        this.fhirRouter.setRoutes(this); // return self for chaining
        return this;
    } // Setup custom logging
}

module.exports = {
    MyFHIRServer
};
