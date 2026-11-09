/**
 * Configuration for the app
 */
const Sentry = require('@sentry/node');
const { profiles } = require('./profiles');
const { getQueryParams } = require('./utils/getQueryParams');

const env = process.env;
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
/**
 * One precedence rule for waitQueueTimeoutMS on every pool: the env var for that pool class,
 * then the pool's own connection string, then the fallback.
 * @param {{envValue: string|undefined, urlValue: number|undefined, fallback: number}} args
 * @returns {number}
 */
const resolveWaitQueueTimeoutMS = ({ envValue, urlValue, fallback }) =>
    envValue ? parseInt(envValue) : (urlValue ?? fallback);
/**
 * How long a request may wait for a pooled connection before the driver throws
 * MongoWaitQueueTimeoutError. The driver default (0) waits forever, so a worker whose
 * pool is exhausted (e.g. by cursors left open after client disconnects) hangs every
 * later request until the caller gives up (INC-357). Failing fast surfaces the error
 * and lets the caller retry on another pod.
 * @type {number}
 */
const waitQueueTimeoutMS = resolveWaitQueueTimeoutMS({
    envValue: env.MONGO_WAIT_QUEUE_TIMEOUT,
    urlValue: queryParams.waitQueueTimeoutMS,
    fallback: 30 * 1000
});
/**
 * Pools that only serve post-request work (audit, access-log and resource-history writes) when
 * configured as their own clusters. Those tasks run after the response is sent and
 * postRequestProcessor logs and drops a failed task, so a checkout timeout there silently loses
 * the record. Fallback 0 keeps the driver's unbounded wait for them; the request path above
 * still fails fast.
 *
 * This only protects a pool that exists. mongoDatabaseManager falls back to the primary client
 * when AUDIT_EVENT_MONGO_URL / RESOURCE_HISTORY_MONGO_URL is unset (access logs follow the audit
 * client), and those writes then share the primary pool and its fail-fast wait above. In prod
 * every deployment sets RESOURCE_HISTORY_MONGO_URL, and AuditEvents go to Kafka -> ClickPipes
 * (ENABLE_AUDIT_EVENT_CLICKPIPE + ENABLE_EVENTS_KAFKA_V2) rather than Mongo, so no post-request
 * write lands on the primary pool. A deployment missing either of those (fhir-proa-server in
 * non-prod today) writes audits to the primary pool, where a saturation-time checkout timeout
 * drops the record; mongoDatabaseManager.connectAsync logs a warning at startup for that case.
 * @type {number}
 */
const BACKGROUND_WAIT_QUEUE_TIMEOUT_FALLBACK_MS = 0;
/**
 * @param {number|undefined} urlValue
 * @returns {number}
 */
const backgroundWaitQueueTimeoutMS = (urlValue) => resolveWaitQueueTimeoutMS({
    envValue: env.MONGO_BACKGROUND_WAIT_QUEUE_TIMEOUT,
    urlValue,
    fallback: BACKGROUND_WAIT_QUEUE_TIMEOUT_FALLBACK_MS
});
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
    waitQueueTimeoutMS,
    writeConcern: {
        w: writeConcern
    }
    // keepAliveInitialDelay: 0,
    // heartbeatFrequencyMS: 30 * 1000,
    // serverSelectionTimeoutMS: 30 * 1000,
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
let auditEventMongoConfig = {
    db_name: mongoConfig.db_name
};
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
            waitQueueTimeoutMS: backgroundWaitQueueTimeoutMS(auditQueryParams.waitQueueTimeoutMS),
            writeConcern: {
                w: auditWriteConcern
            }
        }
    };
}

/**
 * @name mongoConfig
 * @summary Configurations for our Mongo instance
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let auditEventReadOnlyMongoConfig = {
    db_name: auditEventMongoConfig.db_name
};
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
            // request-path reads (AuditEvent search): same fail-fast rule as the primary pool
            waitQueueTimeoutMS: resolveWaitQueueTimeoutMS({
                envValue: env.MONGO_WAIT_QUEUE_TIMEOUT,
                urlValue: auditReadOnlyQueryParams.waitQueueTimeoutMS,
                fallback: 30 * 1000
            }),
            writeConcern: {
                w: auditReadOnlyWriteConcern
            }
        }
    };
}

/**
 * @name mongoConfig
 * @summary Configurations of our Mongo instance for access logs
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let accessLogsMongoConfig = {
    db_name: env.ACCESS_LOGS_MONGO_DB_NAME ? String(env.ACCESS_LOGS_MONGO_DB_NAME) : auditEventMongoConfig.db_name
};
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
    accessLogsMongoUrl = encodeURI(accessLogsMongoUrl);

    const accessLogsQueryParams = getQueryParams(accessLogsMongoUrl);
    const accessLogsWriteConcern = accessLogsQueryParams.w ?? 1;
    delete accessLogsQueryParams.w;

    accessLogsMongoConfig = {
        connection: accessLogsMongoUrl,
        db_name: String(env.ACCESS_LOGS_MONGO_DB_NAME),
        options: {
            ...options,
            ...accessLogsQueryParams,
            writeConcern: { w: accessLogsWriteConcern },
            maxPoolSize: env.ACCESS_LOGS_MAX_POOL_SIZE ? parseInt(env.ACCESS_LOGS_MAX_POOL_SIZE) : 10,
            minPoolSize: env.ACCESS_LOGS_MIN_POOL_SIZE ? parseInt(env.ACCESS_LOGS_MIN_POOL_SIZE) : 1,
            waitQueueTimeoutMS: backgroundWaitQueueTimeoutMS(accessLogsQueryParams.waitQueueTimeoutMS)
        }
    };
    // This accessLogsMongoConfig is used to access Logs using FHIR Admin only
    delete accessLogsMongoConfig.options.compressors;
}

/**
 * @name mongoConfig
 * @summary Configurations for our Mongo instance
 * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }}
 */
let resourceHistoryMongoConfig = {
    db_name: mongoConfig.db_name
};
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
            waitQueueTimeoutMS: backgroundWaitQueueTimeoutMS(resourceHistoryQueryParams.waitQueueTimeoutMS),
            writeConcern: {
                w: resourceHistoryWriteConcern
            }
        }
    };
}

/**
 * @name fhirNotesMongoConfig
 * @summary Configuration for the read-only fhir-notes-vector-store Mongo cluster. Absent
 * `connection` means the feature is not configured in this environment.
 * @type {{connection: string, db_name: string, collection_name: string, index_name: string, options: import('mongodb').MongoClientOptions }}
 */
let fhirNotesMongoConfig = {};
if (env.FHIR_NOTES_MONGO_URL) {
    let fhirNotesMongoUrl = env.FHIR_NOTES_MONGO_URL;
    if (env.FHIR_NOTES_MONGO_USERNAME !== undefined) {
        fhirNotesMongoUrl = fhirNotesMongoUrl.replace(
            'mongodb://',
            `mongodb://${env.FHIR_NOTES_MONGO_USERNAME}:${env.FHIR_NOTES_MONGO_PASSWORD}@`
        );
        fhirNotesMongoUrl = fhirNotesMongoUrl.replace(
            'mongodb+srv://',
            `mongodb+srv://${env.FHIR_NOTES_MONGO_USERNAME}:${env.FHIR_NOTES_MONGO_PASSWORD}@`
        );
    }
    // url-encode the url
    fhirNotesMongoUrl = encodeURI(fhirNotesMongoUrl);
    const fhirNotesQueryParams = getQueryParams(fhirNotesMongoUrl);
    delete fhirNotesQueryParams.w;
    fhirNotesMongoConfig = {
        connection: fhirNotesMongoUrl,
        db_name: env.FHIR_NOTES_MONGO_DB_NAME ? String(env.FHIR_NOTES_MONGO_DB_NAME) : undefined,
        collection_name: env.FHIR_NOTES_MONGO_COLLECTION_NAME
            ? String(env.FHIR_NOTES_MONGO_COLLECTION_NAME)
            : undefined,
        index_name: env.FHIR_NOTES_TEXT_SEARCH_INDEX_NAME
            ? String(env.FHIR_NOTES_TEXT_SEARCH_INDEX_NAME)
            : undefined,
        options: {
            ...options,
            ...fhirNotesQueryParams,
            // read-only workload against a dependency-of-a-dependency cluster: small pool,
            // short timeout so an outage there can't stall fhir-server's primary request path
            minPoolSize: env.FHIR_NOTES_MIN_POOL_SIZE ? parseInt(env.FHIR_NOTES_MIN_POOL_SIZE) : 1,
            maxPoolSize: env.FHIR_NOTES_MAX_POOL_SIZE ? parseInt(env.FHIR_NOTES_MAX_POOL_SIZE) : 10,
            connectTimeoutMS: env.FHIR_NOTES_MONGO_CONNECT_TIMEOUT
                ? parseInt(env.FHIR_NOTES_MONGO_CONNECT_TIMEOUT)
                : 5000,
            serverSelectionTimeoutMS: env.FHIR_NOTES_MONGO_SERVER_SELECTION_TIMEOUT
                ? parseInt(env.FHIR_NOTES_MONGO_SERVER_SELECTION_TIMEOUT)
                : 5000,
            // same intent as the two timeouts above: a saturated notes pool must not hold a
            // primary-path search for the primary pool's 30s
            waitQueueTimeoutMS: resolveWaitQueueTimeoutMS({
                envValue: env.FHIR_NOTES_MONGO_WAIT_QUEUE_TIMEOUT,
                urlValue: fhirNotesQueryParams.waitQueueTimeoutMS,
                fallback: 5000
            })
        }
    };
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
        strategy: {
            name: 'jwt',
            useSession: false
        }
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
    errorTracking: {
        errorHandler: Sentry.setupExpressErrorHandler
    },
    security: [
        {
            url: 'authorize',
            valueUri: `${env.AUTH_SERVER_URI}/authorize`
        },
        {
            url: 'token',
            valueUri: `${env.AUTH_SERVER_URI}/token`
        }
    ],
    //
    // Add any profiles you want to support.  Each profile can support multiple versions
    // if supported by core.  To support multiple versions, just add the versions to the array.
    //
    // Example:
    // Account: {
    //      service: './src/services/account/account.service.js',
    //      versions: [ VERSIONS['4_0_0'] ]
    // },
    //
    profiles
};

module.exports = {
    fhirServerConfig,
    mongoConfig,
    auditEventMongoConfig,
    auditEventReadOnlyMongoConfig,
    accessLogsMongoConfig,
    resourceHistoryMongoConfig,
    fhirNotesMongoConfig
};
