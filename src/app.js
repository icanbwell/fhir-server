/**
 * Main entrypoint that sets up the app
 */
const express = require('express');
const httpContext = require('express-http-context');
const {fhirServerConfig} = require('./config');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const useragent = require('express-useragent');
const {graphql} = require('./middleware/graphql/graphqlServer');
const {graphqlV2} = require('./middleware/graphql/graphqlServerV2.js');

const passport = require('passport');

const {handleAlert} = require('./routeHandlers/alert');
const {MyFHIRServer} = require('./routeHandlers/fhirServer');
const validateContentTypeMiddleware = require('./middleware/contentType-validation.middleware.js');
const {handleSecurityPolicy, handleSecurityPolicyGraphql} = require('./routeHandlers/contentSecurityPolicy');
const {handleHealthCheck} = require('./routeHandlers/healthCheck.js');
const {handleFullHealthCheck} = require('./routeHandlers/healthFullCheck.js');
const {handleVersion} = require('./routeHandlers/version');
const {handleStats} = require('./routeHandlers/stats');
const {handleLogout} = require('./routeHandlers/logout');
const {handleSmartConfiguration} = require('./routeHandlers/smartConfiguration');
const {isTrue} = require('./utils/isTrue');
const cookieParser = require('cookie-parser');
const {handleLivenessCheck} = require('./routeHandlers/probeChecker.js');
const {handleAdminGet, handleAdminPost, handleAdminDelete, handleAdminPut} = require('./routeHandlers/admin');
const {getImageVersion} = require('./utils/getImageVersion');
const {ACCESS_LOGS_ENTRY_DATA, REQUEST_ID_TYPE, REQUEST_ID_HEADER, RESPONSE_NONCE} = require('./constants');
const {generateUUID} = require('./utils/uid.util');
const {logInfo, logDebug} = require('./operations/common/logging');
const {generateNonce} = require('./utils/nonce');
const {handleServerError} = require('./routeHandlers/handleError');
const {shouldReturnHtml} = require('./utils/requestHelpers.js');
const {generateLogDetail} = require('./utils/requestCompletionLogData.js');
const {incrementRequestCount, decrementRequestCount, getRequestCount} = require('./utils/requestCounter');

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
 * @return {import('express').Express}
 */
function createApp({fnGetContainer}) {
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

    const accessLogger = container.accessLogger;

    const httpProtocol = process.env.ENVIRONMENT === 'local' ? 'http' : 'https';

    // Urls to be ignored for which access logs are to be created in db.
    const ignoredUrls = ['/live', '/health', '/ready'];

    // log every incoming request and every outgoing response
    app.use((req, res, next) => {
        // Generates a unique uuid and store in req and later used for operations
        const uniqueRequestId = generateUUID();
        req.uniqueRequestId = uniqueRequestId;
        // Stores the userRequestId in req and later used for logging and creating bundles.
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || uniqueRequestId;

        const reqPath = req.originalUrl;
        const reqMethod = req.method.toUpperCase();

        // Check if the current request count exceeds the configured limit
        if (getRequestCount() > configManager.noOfRequestsPerPod) {
            logInfo('Too Many Requests', {
                path: reqPath,
                method: reqMethod,
                request: {id: req.id, systemGeneratedRequestId: req.uniqueRequestId},
                requestCount: getRequestCount()
            });
            res.status(429).send('Too Many Requests');
            return;
        } else {
            // Increment the request count
            incrementRequestCount();

            // Only log if not /health endpoint
            if (reqPath !== '/health') {
                logInfo('Incoming Request', {
                    path: reqPath,
                    method: reqMethod,
                    request: {id: req.id, systemGeneratedRequestId: req.uniqueRequestId},
                    requestCount: getRequestCount()
                });
            }
        }
        const startTime = new Date().getTime();
        res.on('finish', () => {
            const username = req.authInfo?.context?.username ||
                req.authInfo?.context?.subject ||
                ((!req.user || typeof req.user === 'string') ? req.user : req.user.name || req.user.id);
            const finishTime = new Date().getTime();
            const logData = {
                status: res.statusCode,
                responseTime: `${(finishTime - startTime) / 1000}s`,
                requestUrl: reqPath,
                method: reqMethod,
                userAgent: req.headers['user-agent'],
                originService: req.headers['origin-service'],
                scope: req.authInfo?.scope,
                altId: username,
                requestCount: getRequestCount()
            };
            if (res.statusCode === 401 || res.statusCode === 403) {
                logData.detail = generateLogDetail({
                    authToken: req.headers.authorization,
                    scope: req.authInfo?.scope,
                    statusCode: res.statusCode,
                    username
                });
                // Debug log added for logging authentication token
                if (req.headers.authorization) {
                    logDebug(
                        'Request Completed',
                        {authenticationToken: req.headers.authorization}
                    );
                }
            }

            if (
                configManager.enableAccessLogsMiddleware &&
                (httpContext.get(ACCESS_LOGS_ENTRY_DATA) || req.body)
            ) {
                accessLogger.logAccessLogAsync({
                    ...httpContext.get(ACCESS_LOGS_ENTRY_DATA),
                    req,
                    statusCode: res.statusCode,
                    startTime
                });
            }
            if (!ignoredUrls.some(url => reqPath.startsWith(url))) {
                logInfo('Request Completed', logData);
            }
        });
        res.on('close', () => {
            // Decrement the request count
            decrementRequestCount();

            if (!res.writableFinished && !ignoredUrls.some(url => reqPath.startsWith(url))) {
                const abortTime = new Date().getTime();
                logInfo('Request Aborted', {
                    abortTime: `${(abortTime - startTime) / 1000}s`,
                    requestUrl: reqPath,
                    method: reqMethod,
                    request: {id: req.id, systemGeneratedRequestId: req.uniqueRequestId},
                    requestCount: getRequestCount()
                });
            }
        });
        next();
    });

    // middleware to parse cookies
    app.use(cookieParser());

    // middleware to parse user agent string
    app.use(useragent.express());

    // helmet protects against common OWASP attacks: https://www.securecoding.com/blog/using-helmetjs/
    app.use(helmet());

    // redirect to new fhir-ui if html is requested
    app.use((req, res, next) => {
        if (shouldReturnHtml(req)) {
            const reqPath = req.originalUrl;
            const isGraphQLUrl = reqPath.startsWith('/$graphql') || reqPath.startsWith('/4_0_0/$graphqlv2');
            // check if this is home page, resource page, or admin page
            const isResourceUrl = req.path === '/' || reqPath.startsWith('/4_0_0');
            const isAdminUrl = reqPath.startsWith('/admin');
            // if not graphql url and if keepOldUI flag is not passed and is a resourceUrl then redirect to new UI
            if (!isGraphQLUrl && isTrue(process.env.REDIRECT_TO_NEW_UI) && (isAdminUrl || isResourceUrl)) {
                logInfo('Redirecting to new UI', {path: reqPath});
                if (isAdminUrl || isResourceUrl) {
                    res.redirect(new URL(reqPath, process.env.FHIR_SERVER_UI_URL).toString());
                    return;
                }
            }
        }
        next();
    });

    // middleware for oAuth
    app.use(passport.initialize());

    // Used to initialize context for each request
    app.use(httpContext.middleware);

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
            // Stores uniqueRequestId in httpContext and later used for logging
            httpContext.set(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID, req.uniqueRequestId);

            // Stores the userRquestId in httpContext and later used for logging and creating bundles.
            httpContext.set(REQUEST_ID_TYPE.USER_REQUEST_ID, req.id);
            next();
        }
    );

    // generate nonce, and add to httpContext
    app.use((req, res, next) => {
        const nonce = generateNonce();
        httpContext.set(RESPONSE_NONCE, nonce);
        next();
    });

    app.use(handleSecurityPolicy);

    // disable browser caching
    app.use((req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache');
        res.set('Pragma', 'no-cache');
        next();
    });

    // noinspection JSCheckFunctionSignatures
    // http://localhost:3000/api-docs
    if (isTrue(process.env.ENABLE_SWAGGER_DOC)) {
        const swaggerUi = require('swagger-ui-express');
        const swaggerDocument = require('./swagger_doc.json');
        let swaggerString = JSON.stringify(swaggerDocument);
        swaggerString = swaggerString
            .replace(/<HOST_SERVER>/g, process.env.HOST_SERVER + "/4_0_0")
            .replace(/<ENVIRONMENT>/g, process.env.ENVIRONMENT);
        const configuredSwaggerDocument = JSON.parse(swaggerString);
        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(configuredSwaggerDocument));
    }

    app.use('/oauth', express.static(path.join(__dirname, 'oauth')));

    // handles when the user is redirected by the OpenIDConnect/OAuth provider
    app.get('/authcallback', (req, res) => {
        const state = req.query.state;
        const resourceUrl = state ? encodeURIComponent(Buffer.from(state, 'base64').toString('ascii')) : '';
        const redirectUrl = `${httpProtocol}`.concat('://', `${req.headers.host}`, '/authcallback');
        res.redirect(
            `/oauth/callback.html?code=${req.query.code}&resourceUrl=${resourceUrl}` +
            `&clientId=${process.env.AUTH_CODE_FLOW_CLIENT_ID}&redirectUri=${redirectUrl}` +
            `&tokenUrl=${process.env.AUTH_CODE_FLOW_URL}/oauth2/token`
        );
    });

    app.get('/fhir', (req, res) => {
        const resourceUrl = req.query.resource;
        const redirectUrl = `${httpProtocol}`.concat('://', `${req.headers.host}`, '/authcallback');
        res.redirect(`${process.env.AUTH_CODE_FLOW_URL}/login?response_type=code&client_id=${process.env.AUTH_CODE_FLOW_CLIENT_ID}` +
            `&redirect_uri=${redirectUrl}&state=${resourceUrl}`);
    });

    app.get('/health', (req, res) => handleHealthCheck(
        fnGetContainer, req, res
    ));

    app.get('/full-healthcheck', (req, res) => handleFullHealthCheck(
        fnGetContainer, req, res
    ));

    app.get('/live', (req, res) => handleLivenessCheck(req, res));

    app.get('/logout', handleLogout);
    app.get('/logout_action', (req, res) => {
        const returnUrl = `${httpProtocol}`.concat('://', `${req.headers.host}`, '/logout');
        const logoutUrl = `${process.env.AUTH_CODE_FLOW_URL}/logout?client_id=${process.env.AUTH_CODE_FLOW_CLIENT_ID}&logout_uri=${returnUrl}`;
        res.redirect(logoutUrl);
    });

    if (configManager.enableStatsEndpoint) {
        app.get('/stats', (req, res) => handleStats(
            {fnGetContainer, req, res}
        ));
    }

    app.get('/.well-known/smart-configuration', handleSmartConfiguration, handleServerError);

    app.get('/alert', handleAlert);

    // Need to use version endpoint in fhir app
    app.use(cors(fhirServerConfig.server.corsOptions));
    app.get('/version', handleVersion);

    // Set up admin routes
    // noinspection JSCheckFunctionSignatures
    passport.use('adminStrategy', container.jwt_strategy);

    const adminRouter = express.Router({mergeParams: true});
    // Add authentication
    adminRouter.use(passport.initialize());
    adminRouter.use(passport.authenticate('adminStrategy', {session: false}, null));
    // Add admin routes with json body parser
    const allowedContentTypes = ['application/fhir+json', 'application/json+fhir'];
    adminRouter.get('/admin{/:op}{/:id}', (req, res) => handleAdminGet(fnGetContainer, req, res));
    adminRouter.post(
        '/admin{/:op}{/:id}',
        validateContentTypeMiddleware({allowedContentTypes: allowedContentTypes}),
        express.json({type: allowedContentTypes}),
        (req, res) => handleAdminPost(fnGetContainer, req, res)
    );
    adminRouter.delete('/admin{/:op}', (req, res) => handleAdminDelete(fnGetContainer, req, res));
    adminRouter.put(
        '/admin{/:op}{/:id}',
        validateContentTypeMiddleware({allowedContentTypes: allowedContentTypes}),
        express.json({type: allowedContentTypes}),
        (req, res) => handleAdminPut(fnGetContainer, req, res));

    app.use(adminRouter);

    // noinspection JSCheckFunctionSignatures
    passport.use('graphqlStrategy', container.jwt_strategy);

    // enable middleware for graphql & graphqlv2
    if (isTrue(process.env.ENABLE_GRAPHQL) || configManager.enableGraphQLV2) {
        app.use(cors(fhirServerConfig.server.corsOptions));

        const router = express.Router();
        router.use(passport.initialize());
        router.use(passport.authenticate('graphqlStrategy', {session: false}, null));
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
                    /**
                     * @type {PostRequestProcessor}
                     */
                    const postRequestProcessor = container1.postRequestProcessor;
                    if (postRequestProcessor) {
                        const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                        /**
                         * @type {RequestSpecificCache}
                         */
                        const requestSpecificCache = container1.requestSpecificCache;
                        await postRequestProcessor.executeAsync({requestId});
                        await requestSpecificCache.clearAsync({requestId});
                    }
                }
            });
            next();
        });

        const routerv2 = express.Router();
        routerv2.use(passport.initialize());
        routerv2.use(passport.authenticate('graphqlStrategy', {session: false}, null));
        routerv2.use(cors(fhirServerConfig.server.corsOptions));
        routerv2.use(express.json());
        // enableUnsafeInline because graphql requires it to be true for loading graphql-ui
        routerv2.use(handleSecurityPolicyGraphql);
        routerv2.use(function (req, res, next) {
            res.once('finish', async () => {
                const req1 = req;
                /**
                 * @type {SimpleContainer}
                 */
                const container1 = req1.container;
                if (container1) {
                    /**
                     * @type {PostRequestProcessor}
                     */
                    const postRequestProcessor = container1.postRequestProcessor;
                    if (postRequestProcessor) {
                        const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                        /**
                         * @type {RequestSpecificCache}
                         */
                        const requestSpecificCache = container1.requestSpecificCache;
                        await postRequestProcessor.executeAsync({requestId});
                        await requestSpecificCache.clearAsync({requestId});
                    }
                }
            });
            next();
        });

        Promise.all([
            isTrue(process.env.ENABLE_GRAPHQL) ? graphql(fnGetContainer) : Promise.resolve(),
            configManager.enableGraphQLV2 ? graphqlV2(fnGetContainer) : Promise.resolve()
        ]).then(([graphqlMiddleware, graphqlV2Middleware]) => {
            if (graphqlMiddleware) {
                router.use(graphqlMiddleware);
                app.use('/\\$graphql', router);
            }
            if (graphqlV2Middleware) {
                routerv2.use(graphqlV2Middleware);
                app.use('/4_0_0/\\$graphqlv2', routerv2);
            }
            createFhirApp(fnGetContainer, app);
        });
    } else {
        createFhirApp(fnGetContainer, app);
    }
    app.locals.currentYear = new Date().getFullYear();
    app.locals.deployEnvironment = process.env.ENVIRONMENT;
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

module.exports = {createApp};
