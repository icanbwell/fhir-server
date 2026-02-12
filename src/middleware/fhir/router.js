const versionValidationMiddleware = require('./version-validation.middleware');

const authenticationMiddleware = require('./authentication.middleware');

const sofScopeMiddleware = require('./sof-scope.middleware');

const {
    route: metadataConfig
} = require('./metadata/metadata.config');

const {
    routes: exportConfig
} = require('./export/export.config');

const {
    routeArgs,
    routes
} = require('./route.config');

const hyphenToCamelcase = require('./utils/hyphen-to-camel.utils');

const { getArgsMiddleware } = require('./utils/getArgs.utils');

const {
    ControllerUtils
} = require('./controller.utils');

const {
    getSearchParameters
} = require('./utils/params.utils');

const { VERSIONS, INTERACTIONS } = require('./utils/constants');

const { CustomOperationsController } = require('./4_0_0/controllers/operations.controller');

const cors = require('cors');
const { assertTypeEquals } = require('../../utils/assertType');
const { NotFoundError } = require('../../utils/httpErrors');
const { isTrue } = require('../../utils/isTrue');

const uniques = list => list.filter((val, index, self) => val && self.indexOf(val) === index);

class FhirRouter {
    /**
     * constructor
     * @param {ControllerUtils} controllerUtils
     * @param {CustomOperationsController} customOperationsController
     */
    constructor ({ controllerUtils, customOperationsController }) {
        assertTypeEquals(controllerUtils, ControllerUtils);
        /**
         * @type {ControllerUtils}
         */
        this.controllerUtils = controllerUtils;
        assertTypeEquals(customOperationsController, CustomOperationsController);
        /**
         * @type {CustomOperationsController}
         */
        this.customOperationsController = customOperationsController;
    }

    /**
     * @function getAllConfiguredVersions
     * @description Get a unique list of versions provided in profile configurations
     * @param {Object} profiles - Profile configurations from end users
     * @return {Array<String>} Array of versions we need to support
     */

    getAllConfiguredVersions (profiles = {}) {
        const supportedVersions = Object.values(VERSIONS);
        const providedVersions = Object.getOwnPropertyNames(profiles).reduce((set, profile_key) => {
            const {
                versions = []
            } = profiles[profile_key];
            versions.forEach(version => set.add(version));
            return set;
        }, new Set()); // Filter the provided versions by ones we actually support. We need to check this to make
        // sure some user does not pass in a version we do not officially support in core for whatever
        // reason. Otherwise, there may be some compliance issues.

        return Array.from(providedVersions).filter(version => supportedVersions.indexOf(version) !== -1);
    }

    // /**
    //  * @function hasValidService
    //  * @description Does this profile have a service with a function whose name
    //  * matches what the route expects to call when invoked
    //  * @param {object} route - route configuration for this specific route
    //  * @param {object} profile - profile configuration for this particular profile
    //  * @return {boolean}
    //  */
    // hasValidService(route = {}, profile = {}) {
    //     return Boolean(profile.serviceModule && profile.serviceModule[route.interaction]);
    // }

    /**
     * @function loadController
     * @param {string} lowercaseKey - Profile key
     * @param {string} interaction - Interaction needed to perform
     * @param {Object} service - Consumer provided service module
     * @param {string} resourceType
     * @return {Function} express middleware
     */
    loadController (lowercaseKey, interaction, service, resourceType) {
        return async (req, res, next) => {
            const {
                base_version
            } = req.params;
            const fhirVersion = VERSIONS[base_version] || VERSIONS['4_0_1']; // fallback to r4 for custom baseUrl

            const controller = this.controllerUtils.getController(fhirVersion, lowercaseKey); // Invoke the correct interaction on our controller

            if (!controller[interaction]) {
                return next(new NotFoundError('Route not found'));
            }
            if (controller[interaction]) {
                await controller[interaction](service, resourceType)(req, res, next);
            }
        };
    }

    /**
     * @function enableOperationRoutesForProfile
     * @description Enable custom operation routes provided by the user
     * @param {Object} app - Express application instance
     * @param {Object} config - Application config
     * @param {Object} profile - Profile configuration from end users
     * @param {string} key - Profile name the user has configured
     * @param {Object} corsDefaults - Default cors settings
     */
    enableOperationRoutesForProfile (app, config, profile, key, corsDefaults) {
        // Error message we will use for invalid configurations
        const errorMessage = `Invalid operation configuration for ${key}. Please ` + 'see the wiki on how to use operations. ' + 'https://github.com/icanbwell/fhir-server#cheat-sheet';

        for (const op of profile.operation) {
            const functionName = hyphenToCamelcase(op.name || '');
            // let hasController = profile.serviceModule ? true : false; // Check for required configurations, must have name, route, method, and
            // a matching controller

            if (!op.name || !op.route || !op.method /* || !hasController */) {
                throw new Error(errorMessage);
            }

            const lowercaseMethod = op.method.toLowerCase();
            let interaction;
            switch (lowercaseMethod) {
                case 'post':
                    interaction = INTERACTIONS.OPERATIONS_POST;
                    break;

                case 'delete':
                    interaction = INTERACTIONS.OPERATIONS_DELETE;
                    break;

                default:
                    interaction = INTERACTIONS.OPERATIONS_GET;
            }

            const route = routes.find(rt => rt.interaction === interaction);
            const corsOptions = Object.assign({}, corsDefaults, {
                methods: [route.type.toUpperCase()]
            });
            /**
             * @type {string}
             */
            const resourceType = key;

            let operationsControllerRouteHandler;

            switch (lowercaseMethod) {
                case 'post':
                    operationsControllerRouteHandler = this.customOperationsController.operationsPost({
                        name: functionName,
                        resourceType
                    });
                    break;

                case 'delete':
                    operationsControllerRouteHandler = this.customOperationsController.operationsDelete({
                        name: functionName,
                        resourceType
                    });
                    break;

                default:
                    operationsControllerRouteHandler = this.customOperationsController.operationsGet({
                        name: functionName,
                        resourceType
                    });
            }

            if (profile.baseUrls && profile.baseUrls.length && profile.baseUrls.includes('/')) {
                const operationsRoute = '/'.concat(op.route); // Enable cors with preflight

                app.options(operationsRoute, cors(corsOptions)); // Enable this operation route

                // noinspection JSCheckFunctionSignatures
                app[route.type]( // We need to allow the $ to exist in these routes
                    operationsRoute, cors(corsOptions), versionValidationMiddleware(profile),
                    getArgsMiddleware(),
                    authenticationMiddleware(config),
                    sofScopeMiddleware({
                        route,
                        auth: config.auth,
                        name: key
                    }),
                    operationsControllerRouteHandler
                );
            }

            const operationRoute = route.path.replace(':resource', key).concat(op.route); // Enable cors with preflight

            app.options(operationRoute, cors(corsOptions)); // Enable this operation route

            // noinspection JSCheckFunctionSignatures
            app[route.type]( // We need to allow the $ to exist in these routes
                operationRoute,
                cors(corsOptions),
                versionValidationMiddleware(profile),
                getArgsMiddleware(),
                authenticationMiddleware(config),
                sofScopeMiddleware({
                    route,
                    auth: config.auth,
                    name: key
                }),
                operationsControllerRouteHandler
            );
        }
    }

    enableMetadataRoute (app, config, corsDefaults) {
        const {
            profiles,
            security,
            statementGenerator
        } = config;
        const customBaseUrlProfiles = Object.keys(profiles).map(profileName => {
            const profile = profiles[profileName];

            if (profile.baseUrls && profile.baseUrls.length) {
                return profile;
            }
            return null;
        }).filter(profile => profile !== null && profile !== undefined);
        const inferredProfiles = Object.keys(profiles).map(profileName => {
            const profile = profiles[profileName];

            if (!profile.baseUrls || !profile.baseUrls.length) {
                return profile;
            }
            return null;
        }).filter(profile => profile !== null && profile !== undefined); // Determine which versions need a metadata endpoint, we need to loop through
        // all the configured profiles and find all the uniquely provided versions

        const versionValidationConfiguration = {
            versions: this.getAllConfiguredVersions(profiles)
        };
        const corsOptions = Object.assign({}, corsDefaults, {
            methods: ['GET']
        });

        if (customBaseUrlProfiles.length) {
            const baseUrls = uniques(customBaseUrlProfiles.map(profile => profile.baseUrls).reduce((accum, val) => accum.concat(val), []));
            baseUrls.forEach(baseUrl => {
                const metadataPath = baseUrl === '/' ? '/metadata' : `${baseUrl}/metadata`;
                app.options(metadataPath, cors(corsOptions)); // Enable metadata route

                app.get(metadataPath, cors(corsOptions), getArgsMiddleware(), metadataConfig.controller({
                    profiles,
                    security,
                    statementGenerator
                }));
            });
        }

        if (inferredProfiles.length) {
            // Enable cors with preflight
            app.options(metadataConfig.path, cors(corsOptions)); // Enable metadata route

            app.get(metadataConfig.path, cors(corsOptions), versionValidationMiddleware(versionValidationConfiguration), getArgsMiddleware(), metadataConfig.controller({
                profiles,
                security,
                statementGenerator
            }));
        }
    }

    enableExportRoutes (app, config, corsDefaults) {
        if (!isTrue(process.env.ENABLE_BULK_EXPORT)) {
            return;
        }

        for (const profile of exportConfig) {
            const lowercaseMethod = profile.method.toLowerCase();
            const operationName = profile.operation;

            const corsOptions = Object.assign({}, corsDefaults, profile.corsOptions);

            let operationsControllerRouteHandler;
            switch (lowercaseMethod) {
                case 'post':
                    operationsControllerRouteHandler = this.customOperationsController.operationsPost({
                        name: operationName
                    });
                    break;

                case 'get':
                    operationsControllerRouteHandler = this.customOperationsController.operationsGet({
                        name: operationName
                    });
            }

            app.options(profile.path, cors(corsOptions)); // Enable this operation route

            // noinspection JSCheckFunctionSignatures
            app[profile.method.toLowerCase()](
                profile.path,
                cors(corsOptions),
                versionValidationMiddleware(profile),
                getArgsMiddleware(),
                authenticationMiddleware(config),
                sofScopeMiddleware({
                    route: profile.path,
                    auth: config.auth,
                    name: operationName
                }),
                operationsControllerRouteHandler
            );
        }
    }

    /**
     * @function enableProfileRoutes
     * @description Start iterating over potential routes to enable for this profile
     * @param {Object} app - Express application instance
     * @param {Object} config - Application config
     * @param {Object} profile - Profile configuration from end users
     * @param {string} profileName - Profile name the user has configured
     * @param {Object} corsDefaults - Default cors settings
     */
    enableProfileRoutes (app, config, profile, profileName, corsDefaults) {
        if (profile.operation && profile.operation.length) {
            this.enableOperationRoutesForProfile(app, config, profile, profileName, corsDefaults);
        } // Start iterating over potential routes to enable for this profile
    }

    enableResourceRoutes (app, config, corsDefaults) {
        // Iterate over all of our provided profiles
        for (const profileName in config.profiles) {
            /**
             * @type {string}
             */
            const lowercaseKey = profileName.toLowerCase();
            const profile = config.profiles[profileName];
            /**
             * @type {string}
             */
            const resourceType = profileName;
            const versions = profile.versions; // User's can override arguments by providing their own metadata
            // function, may have more use in other areas in the future

            const overrideArguments = profile.metadata; // We need to check if the provided key is one this server supports
            // so load anything related to the key here and handle with one simple error

            let parameters;

            try {
                parameters = versions.reduce((all, version) => all.concat(getSearchParameters(lowercaseKey, version, overrideArguments)), []);
            } catch (err) {
                throw new Error(`${profileName} is an invalid profile configuration, please see the wiki ` + 'for further instruction' + 'https://github.com/icanbwell/fhir-server#cheat-sheet');
            } // Enable all provided operations for this profile

            this.enableProfileRoutes(app, config, profile, profileName, corsDefaults);

            for (const route of routes) {
                // If we do not have a matching service function for this route, skip it
                // if (!this.hasValidService(route, profile)) {
                //     continue;
                // }

                // Calculate the cors setting we want for this route
                const corsOptions = Object.assign({}, corsDefaults, profile.corsOptions, {
                    methods: [route.type.toUpperCase()]
                }); // Define the arguments based on the interactions

                switch (route.interaction) {
                    case INTERACTIONS.CREATE:
                        route.args = [routeArgs.BASE];
                        break;

                    case INTERACTIONS.SEARCH_BY_ID:
                    case INTERACTIONS.UPDATE:
                    case INTERACTIONS.DELETE:
                    case INTERACTIONS.PATCH:
                        route.args = [routeArgs.BASE, routeArgs.ID];
                        break;

                    case INTERACTIONS.SEARCH:
                    case INTERACTIONS.HISTORY:
                        route.args = [routeArgs.BASE, ...parameters];
                        break;

                    case INTERACTIONS.HISTORY_BY_ID:
                    case INTERACTIONS.EXPAND_BY_ID:
                        route.args = [routeArgs.BASE, routeArgs.ID, ...parameters];
                        break;

                    case INTERACTIONS.SEARCH_BY_VID:
                        route.args = [routeArgs.BASE, routeArgs.ID, routeArgs.VERSION_ID];
                        break;
                }

                if (profile.baseUrls && profile.baseUrls.includes('/')) {
                    const profileRoute = route.path.replace(':resource', profileName).replace(':base_version/', ''); // Enable cors with preflight

                    app.options(profileRoute, cors(corsOptions)); // Enable this operation route

                    app[route.type](profileRoute, cors(corsOptions), getArgsMiddleware(), authenticationMiddleware(config), sofScopeMiddleware({
                        route,
                        auth: config.auth,
                        name: profileName
                    }), this.loadController(lowercaseKey, route.interaction, profile.serviceModule, resourceType));
                } else {
                    const profileRoute = route.path.replace(':resource', profileName); // Enable cors with preflight

                    app.options(profileRoute, cors(corsOptions)); // Enable this operation route

                    app[route.type](
                        profileRoute,
                        cors(corsOptions),
                        versionValidationMiddleware(profile),
                        getArgsMiddleware(),
                        authenticationMiddleware(config),
                        sofScopeMiddleware({
                            route,
                            auth: config.auth,
                            name: profileName
                        }),
                        this.loadController(lowercaseKey, route.interaction, profile.serviceModule, resourceType)
                    );
                }
            }
        }
    }

    enableBaseRoute (app, config, corsDefaults) {
        // Determine which versions need a base endpoint, we need to loop through
        // all the configured profiles and find all the uniquely provided versions
        const routes1 = require('./base/base.config');

        for (const currentRoute of routes1.routes) {
            const versionValidationConfiguration = {
                versions: this.getAllConfiguredVersions(config.profiles)
            };
            const corsOptions = Object.assign({}, corsDefaults, {
                methods: [currentRoute.type.toUpperCase()]
            }); // Enable cors with preflight

            currentRoute.args = [routeArgs.BASE];

            app.options(currentRoute.path, cors(corsOptions)); // Enable base route

            app[currentRoute.type](
                currentRoute.path,
                cors(corsOptions),
                versionValidationMiddleware(versionValidationConfiguration),
                getArgsMiddleware(),
                authenticationMiddleware(config),
                // sofScopeMiddleware({
                //     route: currentRoute,
                //     auth: config.auth,
                //     // name: profileName
                // }),
                currentRoute.controller(
                    {
                        config
                    }
                )
            );
        }
    }

    /**
     * Sets up the routes for FHIR resources
     * @param options
     */
    setRoutes (options = {}) {
        const {
            app,
            config
        } = options;
        const {
            server
        } = config; // Setup default cors options

        const corsDefaults = Object.assign({}, server.corsOptions); // Enable all routes, operations are enabled inside enableResourceRoutes

        this.enableMetadataRoute(app, config, corsDefaults);
        this.enableExportRoutes(app, config, corsDefaults);
        this.enableResourceRoutes(app, config, corsDefaults); // Enable all routes, operations base: Batch and Transactions

        this.enableBaseRoute(app, config, corsDefaults);
    }
}

module.exports = {
    FhirRouter
};
