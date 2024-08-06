/**
 * Configuration for the app
 */
const env = require('var');
const Sentry = require('@sentry/node');
const { profiles } = require('./profiles');
const { getQueryParams } = require('./utils/getQueryParams');

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
const queryParams = getQueryParams(mongoUrl);
const writeConcern = queryParams.w ?? 'majority';
delete queryParams.w;
// noinspection JSValidateTypes
/**
 * https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/connection-options/
 * @type {import('mongodb').MongoClientOptions}
 */
const options = {
    ...queryParams,
    connectTimeoutMS: env.MONGO_CONNECT_TIMEOUT ? parseInt(env.MONGO_CONNECT_TIMEOUT) : 60 * 60 * 1000,
    socketTimeoutMS: env.MONGO_SOCKET_TIMEOUT ? parseInt(env.MONGO_SOCKET_TIMEOUT) : 60 * 60 * 1000,
    retryReads: true,
    maxIdleTimeMS: env.MONGO_IDLE_TIMEOUT ? parseInt(env.MONGO_IDLE_TIMEOUT) : 60 * 60 * 1000,
    // https://www.mongodb.com/developer/products/mongodb/mongodb-network-compression/
    compressors: ['zstd'],
    // https://medium.com/@kyle_martin/mongodb-in-production-how-connection-pool-size-can-bottleneck-application-scale-439c6e5a8424
    minPoolSize: env.MONGO_MIN_POOL_SIZE ? parseInt(env.MONGO_MIN_POOL_SIZE) : 10,
    maxPoolSize: env.MONGO_MAX_POOL_SIZE ? parseInt(env.MONGO_MAX_POOL_SIZE) : 100,
    writeConcern: {
        w: writeConcern
    }
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
const mongoConfig = {
    connection: mongoUrl,
    db_name: String(env.MONGO_DB_NAME),
    options
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
    const auditQueryParams = getQueryParams(auditEventMongoUrl);
    const auditWriteConcern = auditQueryParams.w ?? 'majority';
    delete auditQueryParams.w;
    auditEventMongoConfig = {
        connection: auditEventMongoUrl,
        db_name: String(env.AUDIT_EVENT_MONGO_DB_NAME),
        options: {
            ...options,
            ...auditQueryParams,
            minPoolSize: env.AUDIT_EVENT_MIN_POOL_SIZE ? parseInt(env.AUDIT_EVENT_MIN_POOL_SIZE) : options.minPoolSize,
            maxPoolSize: env.AUDIT_EVENT_MAX_POOL_SIZE ? parseInt(env.AUDIT_EVENT_MAX_POOL_SIZE) : options.maxPoolSize,
            writeConcern: {
                w: auditWriteConcern
            }
        }
    };
} else {
    auditEventMongoConfig = mongoConfig;
}

/**
 * @name mongoConfig
 * @summary Configurations for our Mongo instance
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let auditEventReadOnlyMongoConfig;

if (env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL) {
    let auditEventReadOnlyMongoUrl = env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MONGO_URL;
    if (env.AUDIT_EVENT_MONGO_USERNAME !== undefined) {
        auditEventReadOnlyMongoUrl = auditEventReadOnlyMongoUrl.replace(
            'mongodb://',
            `mongodb://${env.AUDIT_EVENT_MONGO_USERNAME}:${env.AUDIT_EVENT_MONGO_PASSWORD}@`
        );
    }
    // url-encode the url
    auditEventReadOnlyMongoUrl = auditEventReadOnlyMongoUrl ? encodeURI(auditEventReadOnlyMongoUrl) : auditEventReadOnlyMongoUrl;
    const auditReadOnlyQueryParams = getQueryParams(auditEventReadOnlyMongoUrl);
    const auditReadOnlyWriteConcern = auditReadOnlyQueryParams.w ?? 'majority';
    delete auditReadOnlyQueryParams.w;
    auditEventReadOnlyMongoConfig = {
        connection: auditEventReadOnlyMongoUrl,
        db_name: String(env.AUDIT_EVENT_MONGO_DB_NAME),
        options: {
            ...options,
            ...auditReadOnlyQueryParams,
            minPoolSize: env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MIN_POOL_SIZE ? parseInt(env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MIN_POOL_SIZE) : 0,
            maxPoolSize: env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MAX_POOL_SIZE ? parseInt(env.AUDIT_EVENT_ONLINE_ARCHIVE_CLUSTER_MAX_POOL_SIZE) : 100,
            writeConcern: {
                w: auditReadOnlyWriteConcern
            }
        }
    };
} else {
    auditEventReadOnlyMongoConfig = auditEventMongoConfig;
}

/**
 * @name mongoConfig
 * @summary Configurations of our Mongo instance for access logs
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let accessLogsMongoConfig;
if (env.ACCESS_LOGS_CLUSTER_MONGO_URL) {
    let accessLogsMongoUrl = env.ACCESS_LOGS_CLUSTER_MONGO_URL;
    if (env.ACCESS_LOGS_MONGO_USERNAME !== undefined) {
        accessLogsMongoUrl = accessLogsMongoUrl.replace(
            'mongodb://',
            `mongodb://${env.ACCESS_LOGS_MONGO_USERNAME}:${env.ACCESS_LOGS_MONGO_PASSWORD}@`
        );
        accessLogsMongoUrl = accessLogsMongoUrl.replace(
            'mongodb+srv://',
            `mongodb+srv://${env.ACCESS_LOGS_MONGO_USERNAME}:${env.ACCESS_LOGS_MONGO_PASSWORD}@`
        );
    }
    // url-encode the url
    accessLogsMongoUrl = accessLogsMongoUrl ? encodeURI(accessLogsMongoUrl) : accessLogsMongoUrl;
    accessLogsMongoConfig = {
        connection: accessLogsMongoUrl,
        db_name: String(env.ACCESS_LOGS_MONGO_DB_NAME)
    };
} else {
    const dbName = env.ACCESS_LOGS_MONGO_DB_NAME
        ? String(env.ACCESS_LOGS_MONGO_DB_NAME)
        : auditEventMongoConfig.db_name;
    accessLogsMongoConfig = {
        connection: auditEventMongoConfig.connection,
        db_name: dbName
    };
}
const accessLogsQueryParams = getQueryParams(accessLogsMongoConfig.connection);
const accessLogsWriteConcern = accessLogsQueryParams.w ?? 1;
delete accessLogsQueryParams.w;
accessLogsMongoConfig.options = {
    ...options,
    ...accessLogsQueryParams,
    writeConcern: { w: accessLogsWriteConcern },
    maxPoolSize: env.ACCESS_LOGS_MAX_POOL_SIZE ? parseInt(env.ACCESS_LOGS_MAX_POOL_SIZE) : 10,
    minPoolSize: env.ACCESS_LOGS_MIN_POOL_SIZE ? parseInt(env.ACCESS_LOGS_MIN_POOL_SIZE) : 1
};
// This accessLogsMongoConfig is used to access Logs using FHIR Admin only
delete accessLogsMongoConfig.options.compressors;

/**
 * @name mongoConfig
 * @summary Configurations for our Mongo instance
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let resourceHistoryMongoConfig;

if (env.RESOURCE_HISTORY_MONGO_URL) {
    let resourceHistoryMongoUrl = env.RESOURCE_HISTORY_MONGO_URL;
    if (env.RESOURCE_HISTORY_MONGO_USERNAME !== undefined) {
        resourceHistoryMongoUrl = resourceHistoryMongoUrl.replace(
            'mongodb://',
            `mongodb://${env.RESOURCE_HISTORY_MONGO_USERNAME}:${env.RESOURCE_HISTORY_MONGO_PASSWORD}@`
        );
        resourceHistoryMongoUrl = resourceHistoryMongoUrl.replace(
            'mongodb+srv://',
            `mongodb+srv://${env.RESOURCE_HISTORY_MONGO_USERNAME}:${env.RESOURCE_HISTORY_MONGO_PASSWORD}@`
        );
    }
// url-encode the url
    resourceHistoryMongoUrl = resourceHistoryMongoUrl ? encodeURI(resourceHistoryMongoUrl) : resourceHistoryMongoUrl;
    const resourceHistoryQueryParams = getQueryParams(resourceHistoryMongoUrl);
    const resourceHistoryWriteConcern = resourceHistoryQueryParams.w ?? 'majority';
    delete resourceHistoryQueryParams.w;
    resourceHistoryMongoConfig = {
        connection: resourceHistoryMongoUrl,
        db_name: String(env.RESOURCE_HISTORY_MONGO_DB_NAME),
        options: {
            ...options,
            ...resourceHistoryQueryParams,
            minPoolSize: env.RESOURCE_HISTORY_MIN_POOL_SIZE ? parseInt(env.RESOURCE_HISTORY_MIN_POOL_SIZE) : options.minPoolSize,
            maxPoolSize: env.RESOURCE_HISTORY_MAX_POOL_SIZE ? parseInt(env.RESOURCE_HISTORY_MAX_POOL_SIZE) : options.maxPoolSize,
            writeConcern: {
                w: resourceHistoryWriteConcern
            }
        }
    };
} else {
    resourceHistoryMongoConfig = mongoConfig;
}

// Set up whitelist
const whitelist_env = (env.WHITELIST && env.WHITELIST.split(',').map((host) => host.trim())) || false;

// If no whitelist is present, disable cors
// If it's length is 1, set it to a string, so * works
// If there are multiple, keep them as an array
const whitelist = whitelist_env && whitelist_env.length === 1 ? whitelist_env[0] : whitelist_env;

/**
 * @name fhirServerConfig
 * @summary fhir-server configurations.
 */
const fhirServerConfig = {
    auth: {
        // This servers URI
        resourceServer: env.RESOURCE_SERVER
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
            origin: whitelist
        }
    },
    logging: {
        level: env.LOGLEVEL
    },
    errorTracking: {
        requestHandler: Sentry.Handlers.requestHandler,
        errorHandler: Sentry.Handlers.errorHandler
    },
    //
    // If you want to set up conformance statement with security enabled
    // Uncomment the following block
    //
    security: [
        {
            url: 'authorize',
            valueUri: `${env.AUTH_SERVER_URI}/authorize`
        },
        {
            url: 'token',
            valueUri: `${env.AUTH_SERVER_URI}/token`
        }
        // optional - registration
    ],
    //
    // Add any profiles you want to support.  Each profile can support multiple versions
    // if supported by core.  To support multiple versions, just add the versions to the array.
    //
    // Example:
    // Account: {
    //      service: './src/services/account/account.service.js',
    //      versions: [ VERSIONS['4_0_0'], VERSIONS['3_0_1'], VERSIONS['1_0_2'] ]
    // },
    //
    profiles
};

fhirServerConfig.auth = {
    // This servers URI
    resourceServer: env.RESOURCE_SERVER,
    //
    // if you use this strategy, you need to add the corresponding env vars to docker-compose
    //
    strategy: {
        name: 'jwt',
        useSession: false,
        service: './src/strategies/jwt.bearer.strategy.js'
    }
};

module.exports = {
    fhirServerConfig,
    mongoConfig,
    auditEventMongoConfig,
    auditEventReadOnlyMongoConfig,
    accessLogsMongoConfig,
    resourceHistoryMongoConfig
};
