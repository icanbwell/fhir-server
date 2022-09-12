/**
 * Main entrypoint that sets up the app
 */
const express = require('express');
const {fhirServerConfig} = require('./config');
const Prometheus = require('./utils/prometheus.utils');
const cors = require('cors');
const env = require('var');
const helmet = require('helmet');
const path = require('path');
const useragent = require('express-useragent');
const {graphqlv1} = require('./middleware/graphql/graphqlServer1');
const {graphql} = require('./middleware/graphql/graphqlServer');
const {resourceDefinitions} = require('./utils/resourceDefinitions');

const passport = require('passport');
const {strategy} = require('./strategies/jwt.bearer.strategy');

const {handleAlert} = require('./routeHandlers/alert');
const {MyFHIRServer} = require('./routeHandlers/fhirServer');
const {handleSecurityPolicy} = require('./routeHandlers/contentSecurityPolicy');
const {handleVersion} = require('./routeHandlers/version');
const {handleLogout} = require('./routeHandlers/logout');
const {handleClean} = require('./routeHandlers/clean');
const {handleIndex} = require('./routeHandlers/index');
const {handleStats} = require('./routeHandlers/stats');
const {handleSmartConfiguration} = require('./routeHandlers/smartConfiguration');
const {isTrue} = require('./utils/isTrue');
const cookieParser = require('cookie-parser');
const {initialize} = require('./winstonInit');

if (isTrue(env.TRACING_ENABLED)) {
    require('./tracing');
}

/**
 * Creates the FHIR app
 * @param {function (): SimpleContainer} fnCreateContainer
 * @param {import('express').Express} app1
 * @return {MyFHIRServer}
 */
function createFhirApp(fnCreateContainer, app1) {
    return new MyFHIRServer(fnCreateContainer, fhirServerConfig, app1)
        .configureMiddleware()
        .configureSession()
        .configureHelmet()
        .configurePassport()
        .configureHtmlRenderer()
        .setPublicDirectory()
        .setProfileRoutes()
        .configureSlackErrorHandler()
        .setErrorRoutes();
}

/**
 * Creates the app
 * @param {function (): SimpleContainer} fnCreateContainer
 * @return {import('express').Express}
 */
function createApp(fnCreateContainer) {
    initialize();
    const swaggerUi = require('swagger-ui-express');
    // eslint-disable-next-line security/detect-non-literal-require
    const swaggerDocument = require(env.SWAGGER_CONFIG_URL);

    /**
     * @type {Express}
     */
    const app = express();

    const httpProtocol = env.ENVIRONMENT === 'local' ? 'http' : 'https';

    // middleware to parse cookies
    app.use(cookieParser());

    // middleware to parse user agent string
    app.use(useragent.express());

    // middleware for oAuth
    app.use(passport.initialize({}));

    // helmet protects against common OWASP attacks: https://www.securecoding.com/blog/using-helmetjs/
    app.use(helmet());

    // prometheus tracks the metrics
    app.use(Prometheus.requestCounters);
    // noinspection JSCheckFunctionSignatures
    app.use(Prometheus.responseCounters);
    app.use(Prometheus.httpRequestTimer);
    Prometheus.injectMetricsRoute(app);
    Prometheus.startCollection();

    // Set EJS as templating engine
    app.set('views', path.join(__dirname, '/views'));
    app.set('view engine', 'ejs');

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

    // noinspection JSCheckFunctionSignatures
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));

    app.use(express.static(path.join(__dirname, 'oauth')));

    // handles when the user is redirected by the OpenIDConnect/OAuth provider
    app.get('/authcallback', (req, res) => {
        const state = req.query.state;
        const resourceUrl = state ?
            encodeURIComponent(Buffer.from(state, 'base64').toString('ascii')) : '';
        // console.log(`Redirecting to ${resourceUrl}`);
        res.redirect(
            `/callback.html?code=${req.query.code}&resourceUrl=${resourceUrl}` +
            `&clientId=${env.AUTH_CODE_FLOW_CLIENT_ID}&redirectUri=${httpProtocol}://` +
            `${req.headers.host}/authcallback&tokenUrl=${env.AUTH_CODE_FLOW_URL}/oauth2/token`
        );
    });

    app.get('/fhir', (req, res) => {
        const resourceUrl = req.query.resource;
        const redirectUrl = `${env.AUTH_CODE_FLOW_URL}/login?response_type=code&client_id=${env.AUTH_CODE_FLOW_CLIENT_ID}&redirect_uri=${httpProtocol}://${req.headers.host}/authcallback&state=${resourceUrl}`;
        res.redirect(redirectUrl);
    });

    app.get('/health', (req, res) => res.json({status: 'ok'}));
    app.get('/version', handleVersion);
    app.get('/logout', handleLogout);
    app.get('/logout_action', (req, res) => {
        const logoutUrl = `${env.AUTH_CODE_FLOW_URL}/logout?client_id=${env.AUTH_CODE_FLOW_CLIENT_ID}&logout_uri=${env.HOST_SERVER}/logout`;
        res.redirect(logoutUrl);
    });

    // render the home page
    app.get('/', (req, res) => {
        const home_options = {
            resources: resourceDefinitions,
        };
        return res.render(__dirname + '/views/pages/home', home_options);
    });

    app.get('/clean/:collection?', handleClean);

    app.get('/stats', handleStats);

    app.get('/index/:op?/:table?', handleIndex);

    app.get('/.well-known/smart-configuration', handleSmartConfiguration);

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

    // noinspection JSCheckFunctionSignatures
    passport.use('graphqlStrategy', strategy);

    // enable middleware for graphql
    if (isTrue(env.ENABLE_GRAPHQL)) {
        app.use(cors(fhirServerConfig.server.corsOptions));
        const useGraphQLv2 = isTrue(env.USE_GRAPHQL_v2);
        if (useGraphQLv2) {
            graphql(fnCreateContainer)
                .then((graphqlMiddleware) => {
                    // eslint-disable-next-line new-cap
                    const router = express.Router();
                    router.use(passport.initialize({}));
                    router.use(passport.authenticate('graphqlStrategy', {session: false}, null));
                    // noinspection JSCheckFunctionSignatures
                    router.use(graphqlMiddleware);
                    app.use('/graphqlv2', router);

                    app.use('/graphql', router);
                })
                .then((_) => graphqlv1(fnCreateContainer))
                .then((graphqlMiddlewareV1) => {
                    // eslint-disable-next-line new-cap
                    const router1 = express.Router();
                    router1.use(passport.initialize({}));
                    router1.use(passport.authenticate('graphqlStrategy', {session: false}, null));
                    // noinspection JSCheckFunctionSignatures
                    router1.use(graphqlMiddlewareV1);

                    app.use('/graphqlv1', router1);
                })
                .then((_) => {
                    // app.use(fhirApp.app);
                    createFhirApp(fnCreateContainer, app);
                });
        } else {
            graphql(fnCreateContainer)
                .then((graphqlMiddleware) => {
                    // eslint-disable-next-line new-cap
                    const router = express.Router();
                    router.use(passport.initialize({}));
                    router.use(passport.authenticate('graphqlStrategy', {session: false}, null));
                    // noinspection JSCheckFunctionSignatures
                    router.use(graphqlMiddleware);
                    app.use('/graphqlv2', router);
                })
                .then((_) => graphqlv1(fnCreateContainer))
                .then((graphqlMiddlewareV1) => {
                    // eslint-disable-next-line new-cap
                    const router1 = express.Router();
                    router1.use(passport.initialize({}));
                    router1.use(passport.authenticate('graphqlStrategy', {session: false}, null));
                    // noinspection JSCheckFunctionSignatures
                    router1.use(graphqlMiddlewareV1);

                    app.use('/graphqlv1', router1);
                    app.use('/graphql', router1);
                })
                .then((_) => {
                    // app.use(fhirApp.app);
                    createFhirApp(fnCreateContainer, app);
                });
        }
    } else {
        createFhirApp(fnCreateContainer, app);
    }
    app.locals.currentYear = new Date().getFullYear();

    // enables access to reverse proxy information
    // https://expressjs.com/en/guide/behind-proxies.html
    app.enable('trust proxy');

    return app;
}

/**
 *
 * @param {import('express').Express} app
 * @return {boolean}
 */
function unmountRoutes(app) {
    // eslint-disable-next-line new-cap
    app.use('/graphqlv1', express.Router());
    // eslint-disable-next-line new-cap
    app.use('/graphql', express.Router());
    // eslint-disable-next-line new-cap
    app.use('/graphqlv2', express.Router());
}

module.exports = {createApp, unmountRoutes};
