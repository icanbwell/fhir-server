/**
 * Main entrypoint that sets up the app
 */
const express = require('express');
const httpContext = require('express-http-context');
const {fhirServerConfig} = require('./config');
const Prometheus = require('./utils/prometheus.utils');
const cors = require('cors');
const env = require('var');
const helmet = require('helmet');
const path = require('path');
const useragent = require('express-useragent');
const {graphql} = require('./middleware/graphql/graphqlServer');
const {resourceDefinitions} = require('./utils/resourceDefinitions');
const moment = require('moment-timezone');

const passport = require('passport');
const {strategy} = require('./strategies/jwt.bearer.strategy');

const {handleAlert} = require('./routeHandlers/alert');
const {MyFHIRServer} = require('./routeHandlers/fhirServer');
const {handleSecurityPolicy, handleSecurityPolicyGraphql} = require('./routeHandlers/contentSecurityPolicy');
const {handleHealthCheck} = require('./routeHandlers/healthCheck.js');
const {handleFullHealthCheck} = require('./routeHandlers/healthFullCheck.js');
const {handleVersion} = require('./routeHandlers/version');
const {handleLogout} = require('./routeHandlers/logout');
const {handleClean} = require('./routeHandlers/clean');
const {handleStats} = require('./routeHandlers/stats');
const {handleSmartConfiguration} = require('./routeHandlers/smartConfiguration');
const {isTrue} = require('./utils/isTrue');
const cookieParser = require('cookie-parser');
const {handleMemoryCheck} = require('./routeHandlers/memoryChecker');
const {handleAdmin} = require('./routeHandlers/admin');
const {getImageVersion} = require('./utils/getImageVersion');
const {REQUEST_ID_TYPE, REQUEST_ID_HEADER, RESPONSE_NONCE} = require('./constants');
const {generateUUID} = require('./utils/uid.util');
const {logInfo} = require('./operations/common/logging');
const { generateNonce } = require('./utils/nonce');
const { handleServerError } = require('./routeHandlers/handleError');

/**
 * Creates the FHIR app
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('express').Express} app1
 * @returns {MyFHIRServer}
 */
function createFhirApp(fnGetContainer, app1) {
    return new MyFHIRServer(fnGetContainer, fhirServerConfig, app1)
        .configureMiddleware()
        .configureSession()
        .configureHelmet()
        .configurePassport()
        .configureHtmlRenderer()
        .setPublicDirectory()
        .setProfileRoutes()
        .setErrorRoutes();
}

// /**
//  * https://stackoverflow.com/questions/14934452/how-to-get-all-registered-routes-in-express/55589657#55589657
//  * @param app
//  * @returns {*[]}
//  */
// function getRoutes(app) {
//     let route;
//     let routes = [];
//
//     app._router.stack
//         // .filter(r => r.route) // take out all the middleware
//         .forEach(function (middleware) {
//             if (middleware.route) { // routes registered directly on the app
//                 routes.push(middleware.route);
//             } else if (middleware.name === 'router') { // router middleware
//                 middleware.handle.stack.forEach(function (handler) {
//                     route = handler.route;
//                     route && routes.push(route);
//                 });
//             }
//         });
//     return routes;
// }

/**
 * Creates the app
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {boolean} trackMetrics
 * @return {import('express').Express}
 */
function createApp({fnGetContainer, trackMetrics}) {
    const swaggerUi = require('swagger-ui-express');
    // eslint-disable-next-line security/detect-non-literal-require
    const swaggerDocument = require(env.SWAGGER_CONFIG_URL);

    /**
     * @type {import('express').Express}
     */
    const app = express();

    /**
     * @type {SimpleContainer}
     */
    const container = fnGetContainer();
    /**
     * @type {import('./utils/configManager').ConfigManager}
     */
    const configManager = container.configManager;

    const httpProtocol = env.ENVIRONMENT === 'local' ? 'http' : 'https';

    // middleware to parse cookies
    app.use(cookieParser());

    // middleware to parse user agent string
    app.use(useragent.express());

    // middleware for oAuth
    app.use(passport.initialize());

    // helmet protects against common OWASP attacks: https://www.securecoding.com/blog/using-helmetjs/
    app.use(helmet());

    if (trackMetrics) {
        // prometheus tracks the metrics
        app.use(Prometheus.requestCounters);
        // noinspection JSCheckFunctionSignatures
        app.use(Prometheus.responseCounters);
        app.use(Prometheus.httpRequestTimer);
        Prometheus.injectMetricsRoute(app);
        Prometheus.startCollection();
    }

    // Set EJS as templating engine
    app.set('views', path.join(__dirname, '/views'));
    app.set('view engine', 'ejs');

    // Used to initialize context for each request
    app.use(httpContext.middleware);

    // generate nonce, and add to httpContext
    app.use((req, res, next) => {
        const nonce = generateNonce();
        httpContext.set(RESPONSE_NONCE, nonce);
        next();
    });

    app.use(handleSecurityPolicy);

    // noinspection SpellCheckingInspection
    const options = {
        explorer: true,
        swaggerOptions: {
            oauth2RedirectUrl: env.HOST_SERVER + '/api-docs/oauth2-redirect.html',
            oauth: {
                appName: 'Swagger Doc',
                usePkceWithAuthorizationCodeGrant: true,
            },
        },
    };

    /**
     * Generate a unique ID for each request at earliest.
     * Use x-request-id in header if sent.
     */
    app.use(
        (
            /** @type {import('http').IncomingMessage} **/ req,
            /** @type {import('http').ServerResponse} **/ res,
            next
        ) => {
            // Generates a unique uuid that is used for operations
            const uniqueRequestId = generateUUID();
            httpContext.set(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID, uniqueRequestId);

            // Stores the userRquestId in httpContext and later used for logging and creating bundles.
            req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || uniqueRequestId;
            httpContext.set(REQUEST_ID_TYPE.USER_REQUEST_ID, req.id);
            next();
        }
    );

    // log every incoming request
    app.use(async (req, res, next) => {
        const reqPath = req.originalUrl;
        const reqMethod = req.method.toUpperCase();
        logInfo('Incoming Request', {path: reqPath, method: reqMethod});
        next();
    });

    // noinspection JSCheckFunctionSignatures
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));

    app.use(express.static(path.join(__dirname, 'oauth')));

    // handles when the user is redirected by the OpenIDConnect/OAuth provider
    app.get('/authcallback', (req, res) => {
        const state = req.query.state;
        const resourceUrl = state ?
            encodeURIComponent(Buffer.from(state, 'base64').toString('ascii')) : '';
        const redirectUrl = `${httpProtocol}`.concat('://', `${req.headers.host}`, '/authcallback');
        res.redirect(
            `/callback.html?code=${req.query.code}&resourceUrl=${resourceUrl}` +
            `&clientId=${env.AUTH_CODE_FLOW_CLIENT_ID}&redirectUri=${redirectUrl}` +
            `&tokenUrl=${env.AUTH_CODE_FLOW_URL}/oauth2/token`
        );
    });

    app.get('/fhir', (req, res) => {
        const resourceUrl = req.query.resource;
        const redirectUrl = `${httpProtocol}`.concat('://', `${req.headers.host}`, '/authcallback');
        res.redirect(`${env.AUTH_CODE_FLOW_URL}/login?response_type=code&client_id=${env.AUTH_CODE_FLOW_CLIENT_ID}` +
            `&redirect_uri=${redirectUrl}&state=${resourceUrl}`);
    });

    app.get('/health', (req, res) => handleHealthCheck(
        fnGetContainer, req, res
    ));

    app.get('/full-healthcheck', (req, res) => handleFullHealthCheck(
        fnGetContainer, req, res
    ));

    app.get('/live', (req, res) => handleMemoryCheck(req, res));

    app.get('/ready', (req, res) => handleMemoryCheck(req, res));

    app.get('/version', handleVersion);
    app.get('/logout', handleLogout);
    app.get('/logout_action', (req, res) => {
        const returnUrl = `${httpProtocol}`.concat('://', `${req.headers.host}`, '/logout');
        const logoutUrl = `${env.AUTH_CODE_FLOW_URL}/logout?client_id=${env.AUTH_CODE_FLOW_CLIENT_ID}&logout_uri=${returnUrl}`;
        res.redirect(logoutUrl);
    });

    // render the home page
    app.get('/', (
        /** @type {import('express').Request} */ req,
        /** @type {import('express').Response} */ res,
        next) => {
        const home_options = {
            resources: resourceDefinitions,
            user: req.user,
            nonce: httpContext.get(RESPONSE_NONCE),
        };
        if (!configManager.disableNewUI && ((req.cookies && req.cookies['web2']) || configManager.showNewUI)) {
            // fall through to the handler in fhirServer.js
            next();
        } else {
            return res.render(__dirname + '/views/pages/home', home_options);
        }
    });

    app.get('/clean/:collection?', (req, res) => handleClean(
        {fnGetContainer, req, res}
    ));

    if (configManager.enableStatsEndpoint) {
        app.get('/stats', (req, res) => handleStats(
        {fnGetContainer, req, res}
        ));
    }

    app.get('/.well-known/smart-configuration', handleSmartConfiguration, handleServerError);

    app.get('/alert', handleAlert);

    app.use('/images', express.static(path.join(__dirname, 'images')));

    app.use('/favicon.ico', express.static(path.join(__dirname, 'images/favicon.ico')));

    app.use('/css', express.static(path.join(__dirname, 'dist/css')));
    app.use('/js', express.static(path.join(__dirname, 'dist/js')));
    app.use(
        '/js',
        express.static(path.join(__dirname, './../node_modules/vanillajs-datepicker/dist/js'))
    );
    app.use(
        '/css',
        express.static(path.join(__dirname, './../node_modules/vanillajs-datepicker/dist/css'))
    );
    app.use('/css', express.static(path.join(__dirname, '../node_modules/bootstrap/dist/css')));
    app.use('/css', express.static(path.join(__dirname, '../node_modules/fontawesome-4.7/css')));
    app.use(
        '/fonts',
        express.static(path.join(__dirname, '../node_modules/fontawesome-4.7/fonts'))
    );
    app.use('/js', express.static(path.join(__dirname, '../node_modules/bootstrap/dist/js')));
    // serve react js and css files
    app.use('/static', express.static(path.join(__dirname, './web/build/static')));


    if (isTrue(env.AUTH_ENABLED)) {
        // Set up admin routes
        // noinspection JSCheckFunctionSignatures
        passport.use('adminStrategy', strategy);
        app.use(cors(fhirServerConfig.server.corsOptions));
    }

    // eslint-disable-next-line new-cap
    const adminRouter = express.Router({mergeParams: true});
    if (isTrue(env.AUTH_ENABLED)) {
        adminRouter.use(passport.initialize());
        adminRouter.use(passport.authenticate('adminStrategy', {session: false}, null));
    }
    const adminHandler = (req, res) => handleAdmin(
        fnGetContainer, req, res
    );
    adminRouter.get('/admin/:op?', adminHandler);
    adminRouter.post('/admin/:op?', adminHandler);
    app.use(adminRouter);

    if (isTrue(env.AUTH_ENABLED)) {
        // noinspection JSCheckFunctionSignatures
        passport.use('graphqlStrategy', strategy);
    }

    // enable middleware for graphql
    if (isTrue(env.ENABLE_GRAPHQL)) {
        app.use(cors(fhirServerConfig.server.corsOptions));

        graphql(fnGetContainer)
            .then((graphqlMiddleware) => {
                // eslint-disable-next-line new-cap
                const router = express.Router();
                if (isTrue(env.AUTH_ENABLED)) {
                    router.use(passport.initialize());
                    router.use(passport.authenticate('graphqlStrategy', {session: false}, null));
                }
                router.use(cors(fhirServerConfig.server.corsOptions));
                router.use(express.json());
                // enableUnsafeInline because graphql requires it to be true for loading graphql-ui
                router.use(handleSecurityPolicyGraphql);
                router.use(function (req, res, next) {
                    res.once('finish', async () => {
                        const req1 = req;
                        /**
                         * @type {SimpleContainer}
                         */
                        const container1 = req1.container;
                        if (container1) {
                            const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                            const userRequestId = httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID);
                            /**
                             * @type {PostRequestProcessor}
                             */
                            const postRequestProcessor = container1.postRequestProcessor;
                            if (postRequestProcessor) {
                                postRequestProcessor.setExecutionRunningForRequest({ requestId, value: true });
                                /**
                                 * @type {import('./utils/auditLogger').AuditLogger}
                                 */
                                const auditLogger = container1.auditLogger;
                                if (auditLogger) {
                                    await auditLogger.flushAsync({ requestId, method: req.method, userRequestId, currentDate: moment.utc().format('YYYY-MM-DD') });
                                }
                                /**
                                 * @type {RequestSpecificCache}
                                 */
                                const requestSpecificCache = container1.requestSpecificCache;
                                await postRequestProcessor.executeAsync({requestId, isGraphql: true});
                                await requestSpecificCache.clearAsync({requestId});
                            }
                        }
                    });
                    next();
                });
                // noinspection JSCheckFunctionSignatures
                router.use(graphqlMiddleware);
                app.use('/graphqlv2', router);
                app.use('/graphql', router);
                app.use('/\\$graphql', router);
            })
            .then((_) => {
                createFhirApp(fnGetContainer, app);
                // getRoutes(app);
            });

    } else {
        createFhirApp(fnGetContainer, app);
    }
    app.locals.currentYear = new Date().getFullYear();
    app.locals.deployEnvironment = env.ENVIRONMENT;
    app.locals.deployVersion = getImageVersion();

    app.get('/robots.txt', (req, res) => {
        // Your logic for the route goes here
        // If the resource is not found, send a 404 response
        res.status(404).send('Not Found');
    });

    // enables access to reverse proxy information
    // https://expressjs.com/en/guide/behind-proxies.html
    app.enable('trust proxy');

    return app;
}

// /**
//  *
//  * @param {import('express').Express} app
//  * @return {boolean}
//  */
// function unmountRoutes(app) {
//     // eslint-disable-next-line new-cap
//     app.use('/graphql', express.Router());
//     // eslint-disable-next-line new-cap
//     app.use('/graphqlv2', express.Router());
// }

module.exports = {createApp};
