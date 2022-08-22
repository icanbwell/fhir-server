/**
 * This route handler implement the fhir server route.  It inherits from the base FHIR Server and makes some changes
 */

const FHIRServer = require('@asymmetrik/node-fhir-server-core');
const compression = require('compression');
const bodyParser = require('body-parser');
const env = require('var');
const {htmlRenderer} = require('../middleware/htmlRenderer');
const {errorReportingMiddleware} = require('../middleware/slackErrorHandler');
const {isTrue} = require('../utils/isTrue');
const loggers = require('@asymmetrik/node-fhir-server-core/dist/server/winston');
const {resolveSchema, isValidVersion} = require('@asymmetrik/node-fhir-server-core/dist/server/utils/schema.utils');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core/dist/constants');
const ServerError = require('@asymmetrik/node-fhir-server-core/dist/server/utils/server.error');
const {generateUUID} = require('../utils/uid.util');
const helmet = require('helmet');
const express = require('express');
const {FhirRouter} = require('../middleware/fhir/router');
const {assertTypeEquals} = require('../utils/assertType');
// const passport = require('passport');
// const path = require('path');


class MyFHIRServer extends FHIRServer.Server {
    /**
     * constructor
     * @param {function (): SimpleContainer} fnCreateContainer
     * @param {Object} config
     * @param {import('express').Express} app
     */
    constructor(fnCreateContainer, config = {}, app = null) {
        super(config, app);
        // this.config = config;
        // validate(this.config); // TODO: REMOVE: logger in future versions, emit notices for now
        // this.app = app ? app : express(); // Setup some environment variables handy for setup

        /**
         * @type {SimpleContainer}
         */
        this.container = fnCreateContainer();

        /**
         * @type {FhirRouter}
         */
        this.fhirRouter = this.container.fhirRouter;
        assertTypeEquals(this.fhirRouter, FhirRouter);

        let {
            server = {}
        } = this.config;
        this.env = {
            IS_PRODUCTION: !process.env.NODE_ENV || process.env.NODE_ENV === 'production',
            USE_HTTPS: server.ssl && server.ssl.key && server.ssl.cert ? server.ssl : undefined
        };

        // return self for chaining
        return this;
    }

    /**
     * Configures middleware
     * @return {MyFHIRServer}
     */
    configureMiddleware() {
        //Enable error tracking request handler if supplied in config
        if (this.config.errorTracking && this.config.errorTracking.requestHandler) {
            this.app.use(this.config.errorTracking.requestHandler());
        }

        // Enable stack traces
        this.app.set('showStackError', !this.env.IS_PRODUCTION); // Show stack error

        this.app.use(
            compression(
                { // https://www.npmjs.com/package/compression
                    level: 9,
                    filter: (req, _) => {
                        if (req.headers['x-no-compression']) {
                            // don't compress responses with this request header
                            return false;
                        }
                        // compress everything
                        return !isTrue(env.DISABLE_COMPRESSION);
                    }
                }
            )
        );

        // Enable the body parser
        this.app.use(bodyParser.urlencoded({
            extended: true,
            limit: '50mb',
            parameterLimit: 50000
        }));
        this.app.use(bodyParser.json({
            type: ['application/fhir+json', 'application/json+fhir'],
            limit: '50mb'

        }));

        // generate a unique ID for each request.  Use X-REQUEST-ID in header if sent.
        this.app.use((/** @type {import('http').IncomingMessage} **/ req, /** @type {import('http').ServerResponse} **/ res, next) => {
            req.id = req.headers['X-REQUEST-ID'] || generateUUID();
            next();
        });

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
    configureHelmet(helmetConfig) {
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
        this.app.use(helmet(helmetConfig || {
            // Needs https running first
            hsts: this.env.USE_HTTPS
        })); // return self for chaining

        return this;
    } // Configure session


    /**
     * Configures with the session
     * @param {Object|undefined} [session]
     * @return {MyFHIRServer}
     */
    configureSession(session) {
        // Session config can come from the core config as well, let's handle both cases
        let {
            server = {}
        } = this.config; // If a session was passed in the config, let's use it

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
    //     if (this.config.auth && this.config.auth.strategy) {
    //         let {
    //             strategy
    //             // eslint-disable-next-line security/detect-non-literal-require
    //         } = require(path.resolve(this.config.auth.strategy.service));
    //
    //         // noinspection JSCheckFunctionSignatures
    //         passport.use('jwt', strategy);
    //     } // return self for chaining
    //
    //
    //     return this;
    // }

    /**
     * Set up a public directory for static assets
     * @param {string} publicDirectory
     * @return {MyFHIRServer}
     */
    setPublicDirectory(publicDirectory = '') {
        // Public config can come from the core config as well, let's handle both cases
        let {
            server = {}
        } = this.config;

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
     * Configures HTML renderer for rendering HTML pages in browser
     * @return {MyFHIRServer}
     */
    configureHtmlRenderer() {
        if (isTrue(env.RENDER_HTML)) {
            // noinspection JSCheckFunctionSignatures
            this.app.use(htmlRenderer);
        }
        return this;
    }

    /**
     * Configures the error handler to report any errors
     * @return {MyFHIRServer}
     */
    configureSlackErrorHandler() {
        if (env.SLACK_TOKEN && env.SLACK_CHANNEL) {
            this.app.use(errorReportingMiddleware);
        }
        return this;
    }

    /**
     * Sets up routes to catch and show errors
     * @return {MyFHIRServer}
     */
    setErrorRoutes() {
        /**
         * @type {import('winston').logger}
         */
        let logger = loggers.get('default', {});
        //Enable error tracking error handler if supplied in config
        if (this.config.errorTracking && this.config.errorTracking.errorHandler) {
            this.app.use(this.config.errorTracking.errorHandler());
        }

        // Generic catch all error handler
        // Errors should be thrown with next and passed through
        this.app.use(
            (err,
             /** @type {import('http').IncomingMessage} */ req,
             /** @type {import('http').ServerResponse} */ res, next) => {
                // get base from URL instead of params since it might not be forwarded
                const base = req.url.split('/')[1];

                // Get an operation outcome for this instance
                const OperationOutcome = resolveSchema(
                    isValidVersion(base) ? base : VERSIONS['4_0_1'],
                    'operationoutcome'
                );
                if (req.id) {
                    res.setHeader('X-Request-ID', String(req.id));
                }
                // If there is an error and it is an OperationOutcome
                if (err && err.resourceType === OperationOutcome.resourceType) {
                    const status = err.statusCode || 500;
                    res.status(status).json(err);
                } else if (err instanceof ServerError) {
                    const status = err.statusCode || 500;
                    res.status(status).json(new OperationOutcome(err));
                } else if (err) {
                    const error = new OperationOutcome({
                        statusCode: 500,
                        issue: [
                            {
                                severity: 'error',
                                code: 'internal',
                                details: {
                                    text: `Unexpected: ${err.message}`,
                                },
                                diagnostics: env.IS_PRODUCTION ? err.message : err.stack,
                            },
                        ],
                    });

                    logger.error(error);
                    res.status(error.statusCode).json(error);
                } else {
                    next();
                }
            });

        // Nothing has responded by now, respond with 404
        this.app.use((req, res) => {
            // get base from URL instead of params since it might not be forwarded
            const base = req.url.split('/')[1] || VERSIONS['4_0_1'];

            let OperationOutcome;
            if (Object.keys(VERSIONS).includes(base)) {
                OperationOutcome = resolveSchema(base, 'operationoutcome');
            } else {
                // if it's a misplaced URL, just return an R4 OperationOutcome
                OperationOutcome = resolveSchema('4_0_1', 'operationoutcome');
            }

            // Get an operation outcome for this instance
            const error = new OperationOutcome({
                statusCode: 404,
                issue: [
                    {
                        severity: 'error',
                        code: 'not-found',
                        details: {
                            text: `Invalid url: ${req.path}`,
                        },
                    },
                ],
            });
            if (req.id) {
                res.setHeader('X-Request-ID', String(req.id));
            }
            logger.error(error);
            res.status(error.statusCode).json(error);
        });

        // return self for chaining
        return this;
    }

    /**
     * Sets routes for all the operations
     * @return {MyFHIRServer}
     */
    setProfileRoutes() {
        this.fhirRouter.setRoutes(this); // return self for chaining
        return this;
    } // Setup custom logging
}

module.exports = {
    MyFHIRServer
};
