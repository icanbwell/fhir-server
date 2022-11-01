/**
 * Configuration for the app
 */
const env = require('var');
const Sentry = require('./middleware/sentry');
const {profiles} = require('./profiles');
// const {MongoClientOptions} = require('mongodb');

let mongoUrl = env.MONGO_URL || `mongodb://${env.MONGO_HOSTNAME}:${env.MONGO_PORT}`;
if (env.MONGO_USERNAME !== undefined) {
    mongoUrl = mongoUrl.replace(
        'mongodb://',
        `mongodb://${env.MONGO_USERNAME}:${env.MONGO_PASSWORD}@`
    );
    mongoUrl = mongoUrl.replace(
        'mongodb+srv://',
        `mongodb+srv://${env.MONGO_USERNAME}:${env.MONGO_PASSWORD}@`
    );
}
// url-encode the url
mongoUrl = encodeURI(mongoUrl);
// noinspection JSValidateTypes
/**
 * https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/connection-options/
 * @type {import('mongodb').MongoClientOptions}
 */
const options = {
    appName: 'fhir',
    keepAlive: true,
    connectTimeoutMS: env.MONGO_CONNECT_TIMEOUT ? parseInt(env.MONGO_CONNECT_TIMEOUT) : 60 * 60 * 1000,
    socketTimeoutMS: env.MONGO_SOCKET_TIMEOUT ? parseInt(env.MONGO_SOCKET_TIMEOUT) : 60 * 60 * 1000,
    retryReads: true,
    maxIdleTimeMS: env.MONGO_IDLE_TIMEOUT ? parseInt(env.MONGO_IDLE_TIMEOUT) : 60 * 60 * 1000,
    // https://www.mongodb.com/developer/products/mongodb/mongodb-network-compression/
    compressors: ['zstd'],
    // https://medium.com/@kyle_martin/mongodb-in-production-how-connection-pool-size-can-bottleneck-application-scale-439c6e5a8424
    minPoolSize: env.MONGO_MIN_POOL_SIZE ? parseInt(env.MONGO_MIN_POOL_SIZE) : 10,
    // keepAliveInitialDelay: 0,
    // heartbeatFrequencyMS: 30 * 1000,
    // serverSelectionTimeoutMS: 30 * 1000,
    // waitQueueTimeoutMS: 30 * 1000
};
/**
 * @name mongoConfig
 * @summary Configurations for our Mongo instance
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let mongoConfig = {
    connection: mongoUrl,
    db_name: String(env.MONGO_DB_NAME),
    options: options,
};

/**
 * @name mongoConfig
 * @summary Configurations for our Mongo instance
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let auditEventMongoConfig;

if (env.AUDIT_EVENT_MONGO_URL) {
    let auditEventMongoUrl = env.AUDIT_EVENT_MONGO_URL;
    if (env.AUDIT_EVENT_MONGO_USERNAME !== undefined) {
        auditEventMongoUrl = auditEventMongoUrl.replace(
            'mongodb://',
            `mongodb://${env.AUDIT_EVENT_MONGO_USERNAME}:${env.AUDIT_EVENT_MONGO_PASSWORD}@`
        );
        auditEventMongoUrl = auditEventMongoUrl.replace(
            'mongodb+srv://',
            `mongodb+srv://${env.AUDIT_EVENT_MONGO_USERNAME}:${env.AUDIT_EVENT_MONGO_PASSWORD}@`
        );
    }
// url-encode the url
    auditEventMongoUrl = auditEventMongoUrl ? encodeURI(auditEventMongoUrl) : auditEventMongoUrl;
    auditEventMongoConfig = {
        connection: auditEventMongoUrl,
        db_name: String(env.AUDIT_EVENT_MONGO_DB_NAME),
        options: options,
    };
} else {
    auditEventMongoConfig = mongoConfig;
}

// Set up whitelist
let whitelist_env = (env.WHITELIST && env.WHITELIST.split(',').map((host) => host.trim())) || false;

// If no whitelist is present, disable cors
// If it's length is 1, set it to a string, so * works
// If there are multiple, keep them as an array
let whitelist = whitelist_env && whitelist_env.length === 1 ? whitelist_env[0] : whitelist_env;

/**
 * @name fhirServerConfig
 * @summary @asymmetrik/node-fhir-server-core configurations.
 */
let fhirServerConfig = {
    auth: {
        // This servers URI
        resourceServer: env.RESOURCE_SERVER,
        //
        // if you use this strategy, you need to add the corresponding env vars to docker-compose
        //
        // strategy: {
        //     name: 'bearer',
        //     useSession: false,
        //     service: './src/strategies/bearer.strategy.js'
        // },
    },
    server: {
        // support various ENV that uses PORT vs SERVER_PORT
        port: env.PORT || env.SERVER_PORT,
        // allow Access-Control-Allow-Origin
        corsOptions: {
            maxAge: 86400,
            origin: whitelist,
        },
    },
    logging: {
        level: env.LOGLEVEL,
    },
    errorTracking: {
        requestHandler: Sentry.Handlers.requestHandler,
        errorHandler: Sentry.Handlers.errorHandler,
    },
    //
    // If you want to set up conformance statement with security enabled
    // Uncomment the following block
    //
    security: [
        {
            url: 'authorize',
            valueUri: `${env.AUTH_SERVER_URI}/authorize`,
        },
        {
            url: 'token',
            valueUri: `${env.AUTH_SERVER_URI}/token`,
        },
        // optional - registration
    ],
    //
    // Add any profiles you want to support.  Each profile can support multiple versions
    // if supported by core.  To support multiple versions, just add the versions to the array.
    //
    // Example:
    // Account: {
    //		service: './src/services/account/account.service.js',
    //		versions: [ VERSIONS['4_0_0'], VERSIONS['3_0_1'], VERSIONS['1_0_2'] ]
    // },
    //
    profiles: profiles,
};

if (env.AUTH_ENABLED === '1') {
    fhirServerConfig.auth = {
        // This servers URI
        resourceServer: env.RESOURCE_SERVER,
        //
        // if you use this strategy, you need to add the corresponding env vars to docker-compose
        //
        strategy: {
            name: 'jwt',
            useSession: false,
            service: './src/strategies/jwt.bearer.strategy.js',
        },
    };
}

module.exports = {
    fhirServerConfig,
    mongoConfig,
    auditEventMongoConfig,
};
