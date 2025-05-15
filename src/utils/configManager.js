const env = require('var');
const {isTrue} = require('./isTrue');
const {CLOUD_STORAGE_CLIENTS, DEFAULT_CACHE_EXPIRY_TIME} = require('../constants');

class ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        // see if resourceType is in list of resources we want to partitionConfig in this environment
        /**
         * @type {string|undefined}
         */
        const partitionResourcesString = env.PARTITION_RESOURCES;
        return partitionResourcesString
            ? partitionResourcesString.split(',').map(s => String(s).trim()) : [];
    }

    get resourcesWithAccessIndex() {
        return (
            env.COLLECTIONS_ACCESS_INDEX && env.COLLECTIONS_ACCESS_INDEX.split(',')
                .map((col) => col.trim())
        ) || [];
    }

    get useAccessIndex() {
        return isTrue(env.USE_ACCESS_INDEX);
    }

    /**
     * @return {string[]|null}
     */
    get requiredFiltersForAuditEvent() {
        return (
            env.REQUIRED_AUDIT_EVENT_FILTERS && env.REQUIRED_AUDIT_EVENT_FILTERS.split(',')
                .map((col) => col.trim())
        ) || null;
    }

    /**
     * @description The max range period for which AuditEvent is to queried.
     * @return {number}
     */
    get auditEventMaxRangePeriod() {
        return env.AUDIT_EVENT_MAX_RANGE_PERIOD ? Number(env.AUDIT_EVENT_MAX_RANGE_PERIOD) : 30;
    }

    /**
     * whether to enable two step optimization
     * @return {boolean}
     */
    get enableTwoStepOptimization() {
        return isTrue(env.USE_TWO_STEP_SEARCH_OPTIMIZATION);
    }

    /**
     * whether to stream the response
     * @return {boolean}
     */
    get streamResponse() {
        return isTrue(env.STREAM_RESPONSE);
    }

    get doNotRequirePersonOrPatientIdForPatientScope() {
        return isTrue(env.DO_NOT_REQUIRE_PERSON_OR_PATIENT_FOR_PATIENT_SCOPE);
    }

    /**
     * current environment value
     * @return {string|null}
     */
    get environmentValue() {
        return env.ENVIRONMENT || '';
    }

    /**
     * current hostname value
     * @return {string|null}
     */
    get hostnameValue() {
        return env.HOSTNAME || '';
    }

    /**
     * docker image
     * @return {string|null}
     */
    get dockerImageValue() {
        return env.DOCKER_IMAGE || '';
    }

    /**
     * @param {string} resourceType
     * @returns {string[]}
     */
    accessTagsIndexed(resourceType) {
        let indexList = (
            env.ACCESS_TAGS_INDEXED && env.ACCESS_TAGS_INDEXED.split(',')
                .map((col) => col.trim())
        ) || [];

        switch (resourceType) {
            case 'Encounter':
                indexList = indexList.concat(
                    (
                        env.ACCESS_TAGS_INDEXED_ENCOUNTER && env.ACCESS_TAGS_INDEXED_ENCOUNTER.split(',')
                            .map((col) => col.trim())
                    ) || []
                );
                break;
            case 'ExplanationOfBenefit':
                indexList = indexList.concat(
                    (
                        env.ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT && env.ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT.split(',')
                            .map((col) => col.trim())
                    ) || []
                );
                break;
            case 'Organization':
                indexList = indexList.concat(
                    (
                        env.ACCESS_TAGS_INDEXED_ORGANIZATION && env.ACCESS_TAGS_INDEXED_ORGANIZATION.split(',')
                            .map((col) => col.trim())
                    ) || []
                );
                break;
            case 'Practitioner':
                indexList = indexList.concat(
                    (
                        env.ACCESS_TAGS_INDEXED_PRACTITIONER && env.ACCESS_TAGS_INDEXED_PRACTITIONER.split(',')
                            .map((col) => col.trim())
                    ) || []
                );
                break;
            case 'PractitionerRole':
                indexList = indexList.concat(
                    (
                        env.ACCESS_TAGS_INDEXED_PRACTITIONER_ROLE && env.ACCESS_TAGS_INDEXED_PRACTITIONER_ROLE.split(',')
                            .map((col) => col.trim())
                    ) || []
                );
                break;
        }
        return indexList;
    }

    /**
     * username for kafka auth
     * @return {string|null}
     */
    get kafkaUserName() {
        return env.KAFKA_SASL_USERNAME || null;
    }

    /**
     * password for kafka auth
     * @return {string|null}
     */
    get kafkaPassword() {
        return env.KAFKA_SASL_PASSWORD || null;
    }

    /**
     * auth mechanism for kafka auth
     * @return {string|undefined}
     */
    get kafkaAuthMechanism() {
        return env.KAFKA_SASL_MECHANISM || 'aws';
    }

    /**
     * client id for kafka auth
     * @return {string|undefined}
     */
    get kafkaClientId() {
        return env.KAFKA_CLIENT_ID;
    }

    /**
     * get brokers for kafka
     * @return {string[]}
     */
    get kafkaBrokers() {
        return env.KAFKA_URLS ? env.KAFKA_URLS.split(',') : [];
    }

    /**
     * whether to use ssl for kafka
     * @return {boolean}
     */
    get kafkaUseSsl() {
        return isTrue(env.KAFKA_SSL);
    }

    /**
     * whether to use SASL for kafka
     * @return {boolean}
     */
    get kafkaUseSasl() {
        return isTrue(env.KAFKA_SASL);
    }

    /**
     * whether to send events to kafka
     * @return {boolean}
     */
    get kafkaEnableEvents() {
        return isTrue(env.ENABLE_EVENTS_KAFKA);
    }

    /**
     * whether to send bulk export events to kafka
     * @return {boolean}
     */
    get kafkaEnableExportEvents() {
        return isTrue(env.ENABLE_BULK_EXPORT_KAFKA_EVENTS);
    }

    /**
     * list of resources for which kafka events are enabled
     * @return {boolean}
     */
    get kafkaEnabledResources() {
        return (
            (
                env.KAFKA_ENABLED_RESOURCES && env.KAFKA_ENABLED_RESOURCES.split(',')
                    .map((col) => col.trim())
            ) || ['Consent', 'ExportStatus']
        );
    }

    /**
     * gets url to person matching service
     * @return {string|undefined}
     */
    get personMatchingServiceUrl() {
        return env.PERSON_MATCHING_SERVICE_URL;
    }

    /**
     * whether to create index when we create a collection
     * @returns {boolean}
     */
    get createIndexOnCollectionCreation() {
        return isTrue(env.CREATE_INDEX_ON_COLLECTION_CREATION);
    }

    /**
     * whether to handle concurrency
     * @return {boolean}
     */
    get handleConcurrency() {
        return !isTrue(env.SKIP_HANDLE_CONCURRENCY);
    }

    /**
     * number to times to retry an update
     * @returns {number}
     */
    get replaceRetries() {
        return env.REPLACE_RETRIES || 10;
    }

    /**
     * whether to return data as bundle
     * @return {boolean}
     */
    get enableReturnBundle() {
        return isTrue(env.RETURN_BUNDLE);
    }

    /**
     * The default sort id currently used
     */
    get defaultSortId() {
        return env.DEFAULT_SORT_ID || '_uuid';
    }

    /**
     * whether to support legacy id support in queries
     * @return {boolean}
     */
    get supportLegacyIds() {
        if (env.SUPPORT_LEGACY_IDS === null || env.SUPPORT_LEGACY_IDS === undefined) {
            return true;
        }
        return isTrue(env.SUPPORT_LEGACY_IDS);
    }

    /**
     * Whether meta.source tags are required
     * @return {boolean}
     */
    get requireMetaSourceTags() {
        if (env.REQUIRE_META_SOURCE_TAGS === null || env.REQUIRE_META_SOURCE_TAGS === undefined) {
            return true;
        }
        return isTrue(env.REQUIRE_META_SOURCE_TAGS);
    }

    /**
     * Specifies the number of ids to process in parallel in $graph.  If number of ids passed
     * is greater than this number than we fall back to processing in serial to save memory
     * @return {number}
     */
    get graphBatchSize() {
        return env.GRAPH_BATCH_SIZE || 10;
    }

    /**
     * Specifies the max numbers of parallel process at a time for fetching/streaming resources
     * @return {number}
     */
    get everythingMaxParallelProcess() {
        return parseInt(env.EVERYTHING_MAX_PARALLEL_PROCESS, 10) || 10;
    }

    /**
     * Specifies the number of ids to process in parallel in $everything.  If number of ids passed
     * is greater than this number than we fall back to processing in serial to save memory
     * @return {number}
     */
    get everythingBatchSize() {
        return parseInt(env.EVERYTHING_BATCH_SZIE, 10) || 10;
    }

    /**
     * returns enabled gridFs resources list
     * @returns {string[]}
     */
    get enabledGridFsResources() {
        return env.GRIDFS_RESOURCES ? env.GRIDFS_RESOURCES.split(',') : [];
    }

    /**
     * Specifies whether to Consent based data access enabled.
     * @return {boolean}
     */
    get enableConsentedProaDataAccess() {
        return isTrue(env.ENABLE_CONSENTED_PROA_DATA_ACCESS);
    }

    /**
     * Specifies allowed connection types for consent data sharing.
     * @return {string[]}
     */
    get getConsentConnectionTypesList() {
        return env.CONSENT_CONNECTION_TYPES_LIST ? env.CONSENT_CONNECTION_TYPES_LIST.split(',') : ['proa'];
    }

    /**
     * Specifies whether to enable HIE/Treatment related data access.
     * @return {boolean}
     */
    get enableHIETreatmentRelatedDataAccess() {
        return isTrue(env.ENABLE_HIE_TREATMENT_RELATED_DATA_ACCESS);
    }

    /**
     * Specifies allowed connection types for HIE/Treatment related data.
     * @return {string[]}
     */
    get getHIETreatmentConnectionTypesList() {
        return env.HIE_TREATMENT_CONNECTION_TYPES_LIST ? env.HIE_TREATMENT_CONNECTION_TYPES_LIST.split(',') : ['hipaa'];
    }

    /**
     * Specifies "provision.class.code" for the Data sharing Consent
     * @return {string[]}
     */
    get getDataSharingConsentCodes() {
        return env.DATA_SHARING_CONSENT_CODES ? env.DATA_SHARING_CONSENT_CODES.split(',') : ['/dataSharingConsent', '/hipaaConsent'];
    }

    /**
     * Specifies maximum buffer when streaming data
     * https://nodejs.org/docs/latest-v18.x/api/stream.html#buffering
     * @returns {number}
     */
    get streamingHighWaterMark() {
        return env.STREAMING_HIGH_WATER_MARK || 100;
    }

    /**
     * whether to log inside our streaming.  Very verbose so don't set in production
     * @returns {boolean}
     */
    get logStreamSteps() {
        return isTrue(env.LOG_STREAM_STEPS);
    }

    /**
     * url to fhir validation service e.g., http://localhost:8080/fhir/
     * @returns {string|undefined}
     */
    get fhirValidationUrl() {
        return env.FHIR_VALIDATION_URL;
    }

    /**
     * Batch size for parallel fetching/updating profiles in HAPI Fhir
     */
    get batchSizeForRemoteFhir() {
        return Number(env.REMOTE_FHIR_REQUEST_BATCH_SIZE) || 10;
    }

    /**
     * whether to validate schemas
     * @returns {boolean}
     */
    get validateSchema() {
        return isTrue(env.VALIDATE_SCHEMA);
    }

    /**
     * returns the size of payload that should be acceptable
     * @returns {string}
     */
    get payloadLimit() {
        return env.PAYLOAD_LIMIT || '50mb';
    }

    /**
     * returns the request timeout in ms
     * @returns {number}
     */
    get requestTimeoutMs() {
        return (parseInt(env.EXTERNAL_REQUEST_TIMEOUT_SEC) || 30) * 1000;
    }

    /**
     * whether to enable stats endpoint
     * @returns {boolean}
     */
    get enableStatsEndpoint() {
        if (env.ENABLE_STATS_ENDPOINT === null || env.ENABLE_STATS_ENDPOINT === undefined) {
            return false;
        }

        return isTrue(env.ENABLE_STATS_ENDPOINT);
    }

    /**
     * whether to enable graphql playground
     * @returns {boolean}
     */
    get enableGraphQLPlayground() {
        if (env.ENABLE_GRAPHQL_PLAYGROUND === null || env.ENABLE_GRAPHQL_PLAYGROUND === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_GRAPHQL_PLAYGROUND);
    }

    /**
     * whether to enable graphqlv2
     * @returns {boolean}
     */
    get enableGraphQLV2() {
        if (env.ENABLE_GRAPHQLV2 === null || env.ENABLE_GRAPHQLV2 === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_GRAPHQLV2);
    }

    /**
     * whether to enable graphqlv2 playground
     * @returns {boolean}
     */
    get enableGraphQLV2Playground() {
        if (env.ENABLE_GRAPHQLV2_PLAYGROUND === null || env.ENABLE_GRAPHQLV2_PLAYGROUND === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_GRAPHQLV2_PLAYGROUND);
    }

    /**
     * returns the batch size used in dataloader to fetch resources
     * @returns {number}
     */
    get graphQLFetchResourceBatchSize() {
        return parseInt(env.GRAPHQL_FETCH_RESOURCE_BATCH_SIZE) || 50;
    }

    /**
     * whether to read audit event data from archive
     * @returns {boolean}
     */
    get enableAuditEventArchiveRead() {
        if (env.AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ === null || env.AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ === undefined) {
            return false;
        }
        return isTrue(env.AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ);
    }

    /**
     * whether to write access logs from middleware
     */
    get enableAccessLogsMiddleware() {
        if (env.ENABLE_ACCESS_LOGS_MIDDLEWARE === null || env.ENABLE_ACCESS_LOGS_MIDDLEWARE === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_ACCESS_LOGS_MIDDLEWARE);
    }

    /**
     * whether to rewrite patient references to proxy-patient reference
     */
    get rewritePatientReference() {
        if (env.REWRITE_PATIENT_REFERENCE === null || env.REWRITE_PATIENT_REFERENCE === undefined) {
            return true;
        }
        return isTrue(env.REWRITE_PATIENT_REFERENCE);
    }

    /**
     * returns number of resources to process in parallel
     * @returns {number}
     */
    get mergeParallelChunkSize() {
        return parseInt(env.MERGE_PARALLEL_CHUNK_SIZE) || 50;
    }

    /**
     * returns cron expression for postRequest processes
     * @returns {string}
     */
    get postRequestFlushTime() {
        // default cron expression is to run the function every 5 sec
        return env.POST_REQUEST_FLUSH_TIME || '*/5 * * * * *';
    }

    /**
     * returns the buffer size for post request processes
     * @returns {number}
     */
    get postRequestBatchSize() {
        return parseInt(env.POST_REQUEST_BATCH_SIZE) || 50;
    }

    /**
     * S3 bucket name to export data to S3
     */
    get bulkExportS3BucketName() {
        return env.BULK_EXPORT_S3_BUCKET_NAME;
    }

    /**
     * Region for AWS services to use
     */
    get awsRegion() {
        return env.AWS_REGION || 'us-east-1';
    }

    /**
     * the timeout to set for mongo operations
     * @return {number}
     */
    get mongoTimeout() {
        return env.MONGO_TIMEOUT ? parseInt(env.MONGO_TIMEOUT) : 2 * 60 * 1000;
    }

    /**
     * the timeout to set for mongo operations
     * @return {number}
     */
    get mongoStreamingTimeout() {
        return env.MONGO_STREAMING_TIMEOUT ? parseInt(env.MONGO_STREAMING_TIMEOUT) : 60 * 60 * 1000;
    }

    /**
     * the size limit for request body in access log
     * @return {number}
     */
    get accessLogRequestBodyLimit() {
        return env.ACCESS_LOG_REQUEST_BODY_SIZE_LIMIT
            ? parseInt(env.ACCESS_LOG_REQUEST_BODY_SIZE_LIMIT)
            : 7 * 1024 * 1024; // 7 MB
    }

    /**
     * the size limit for result in access log
     * @return {number}
     */
    get accessLogResultLimit() {
        return env.ACCESS_LOG_RESULT_SIZE_LIMIT
            ? parseInt(env.ACCESS_LOG_RESULT_SIZE_LIMIT)
            : 7 * 1024 * 1024; // 7 MB
    }

    /**
     * Gets the number of requests allowed per pod.
     * @returns {number} The number of requests allowed per pod.
     */
    get noOfRequestsPerPod() {
        return env.NO_OF_REQUESTS_PER_POD ? parseInt(env.NO_OF_REQUESTS_PER_POD) : 1000;
    }

    /**
     * whether to enable Vulcan IG queries
     * @return {boolean}
     */
    get enableVulcanIgQuery() {
        return isTrue(env.ENABLE_VULCAN_IG_QUERY);
    }

    /**
     * whether to enable MongoDB projections in GraphQL
     * @returns {boolean}
     */
    get enableMongoProjectionsInGraphQL() {
        if (env.ENABLE_MONGO_PROJECTIONS_IN_GRAPHQL === null || env.ENABLE_MONGO_PROJECTIONS_IN_GRAPHQL === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_MONGO_PROJECTIONS_IN_GRAPHQL);
    }

    /**
     * whether to enable MongoDB projections in GraphQL V2
     * @returns {boolean}
     */
    get enableMongoProjectionsInGraphQLv2() {
        if (env.ENABLE_MONGO_PROJECTIONS_IN_GRAPHQLV2 === null || env.ENABLE_MONGO_PROJECTIONS_IN_GRAPHQLV2 === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_MONGO_PROJECTIONS_IN_GRAPHQLV2);
    }

    /**
     * Cloud storage batch download size
     * @returns {number}
     */
    get cloudStorageBatchDownloadSize() {
        return env.CLOUD_STORAGE_BATCH_DOWNLOAD_SIZE ? parseInt(env.CLOUD_STORAGE_BATCH_DOWNLOAD_SIZE) : 100
    }

    /**
     * returns list of history resources that are stored in cloud storage
     * @return {string[]}
     */
    get cloudStorageHistoryResources() {
        return (
            (env.CLOUD_STORAGE_HISTORY_RESOURCES &&
                env.CLOUD_STORAGE_HISTORY_RESOURCES.split(',').map((col) => col.trim())) || ['Binary']
        );
    }

    /**
     * returns list of history resource's fields which are to be kept in MongoDB
     * @return {string[]}
     */
    get historyResourceMongodbFields() {
        return (
            (env.HISTORY_RESOURCE_MONGODB_FIELDS &&
                env.HISTORY_RESOURCE_MONGODB_FIELDS.split(',').map((col) => col.trim())) || [
                'id',
                'resource._uuid',
                'resource._sourceId',
                'resource.meta'
            ]
        );
    }

    /**
     * returns list of resources for which Coding element's id needs to be updated in pre save.
     * Adding 'Resource' to list enables it for all resources
     * @return {string[]}
     */
    get preSaveCodingIdUpdateResources() {
        return (
            (env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES &&
                env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES.split(',').map((col) => col.trim())) ||
            []
        );
    }

    /**
     * Cloud storage client for history resources
     * @returns {string}
     */
    get historyResourceCloudStorageClient() {
        return env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT;
    }

    /**
     * Cloud storage bucket name for history resources
     * @returns {string}
     */
    get historyResourceBucketName() {
        return env.HISTORY_RESOURCE_BUCKET_NAME;
    }

    /**
     * Cloud storage client max retry attempt count
     * @returns {number}
     */
    get cloudStorageClientMaxRetry() {
        return env.CLOUD_STORAGE_CLIENT_MAX_RETRY ? parseInt(env.CLOUD_STORAGE_CLIENT_MAX_RETRY) : 3;
    }

    /**
     * Cloud storage client limit for receiving response
     * @returns {number}
     */
    get cloudStorageClientRequestTimeout() {
        return env.CLOUD_STORAGE_CLIENT_REQUEST_TIMEOUT ? parseInt(env.CLOUD_STORAGE_CLIENT_REQUEST_TIMEOUT) : 10 * 1000; // 10 sec
    }

    /**
     * Cloud storage client limit for establishing connection
     * @returns {number}
     */
    get cloudStorageClientConnectionTimeout() {
        return env.CLOUD_STORAGE_CLIENT_CONNECTION_TIMEOUT ? parseInt(env.CLOUD_STORAGE_CLIENT_CONNECTION_TIMEOUT) : 5 * 1000; // 5 sec
    }

    /**
     * Limit for number of History resources to Cloud storage in a cron job
     * @returns {number}
     */
    get historyResourceCronJobMigrationLimit() {
        return env.HISTORY_CRON_JOB_MIGRATION_LIMIT ? parseInt(env.HISTORY_CRON_JOB_MIGRATION_LIMIT) : 100000;
    }

    /**
     * returns list resources for which making resource class object step needs to be skipped
     * @return {string[]}
     */
    get skipClassObjectResources() {
        return (
            (env.SKIP_CLASS_OBJECT_RESOURCES &&
                env.SKIP_CLASS_OBJECT_RESOURCES.split(',').map((col) => col.trim())) || ['Composition']
        );
    }

    /**
     * returns list of resources for which making resource class object step needs to be skipped in get list
     * @return {string[]}
     */
    get skipClassObjectResourcesInList() {
        return (
            (env.SKIP_CLASS_OBJECT_RESOURCES_IN_LIST &&
                env.SKIP_CLASS_OBJECT_RESOURCES_IN_LIST.split(',').map((col) => col.trim())) || ['Composition']
        );
    }

    /**
     * returns whether to skip class objection creation in graphqlv2
     * @return {Boolean}
     */
    get getRawGraphQLV2Bundle() {
        if (env.ENABLE_RAW_BUNDLE_IN_GRAPHQLV2 === null || env.ENABLE_RAW_BUNDLE_IN_GRAPHQLV2 === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_RAW_BUNDLE_IN_GRAPHQLV2);
    }

    /**
     * returns whether to skip class objection creation in graphql
     * @return {Boolean}
     */
    get getRawGraphQLBundle() {
        if (env.ENABLE_RAW_BUNDLE_IN_GRAPHQL === null || env.ENABLE_RAW_BUNDLE_IN_GRAPHQL === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_RAW_BUNDLE_IN_GRAPHQL);
    }

    /**
     * returns whether to skip class object creation in $everything operation
     * @return {Boolean}
     */
    get getRawEverythingOpBundle() {
        if (env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP === null || env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP);
    }

    /**
     * returns whether to use fast serialization for search list
     * @return {Boolean}
     */
    get enableFastSerializerInSearch() {
        if (env.ENABLE_FAST_SERIALIZER_IN_SEARCH === null || env.ENABLE_FAST_SERIALIZER_IN_SEARCH === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_FAST_SERIALIZER_IN_SEARCH);
    }

    /**
     * returns whether to use fast serialization for search by id
     * @return {Boolean}
     */
    get enableFastSerializerInSearchById() {
        if (env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID === null || env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID);
    }

    /**
     * returns whether to use fast serialization for $graph operation
     * @return {Boolean}
     */
    get enableFastSerializerInGraphOp() {
        if (env.ENABLE_FAST_SERIALIZER_IN_GRAPH_OP === null || env.ENABLE_FAST_SERIALIZER_IN_GRAPH_OP === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_FAST_SERIALIZER_IN_GRAPH_OP);
    }

    /**
     * Disable using graph for everything and instead use everythingHelper
     * @returns {boolean}
     */
    get disableGraphInEverythingOp() {
        if (env.DISABLE_GRAPH_IN_EVERYTHING_OP === null || env.DISABLE_GRAPH_IN_EVERYTHING_OP === undefined) {
            return false;
        }
        return isTrue(env.DISABLE_GRAPH_IN_EVERYTHING_OP);
    }

    /**
     * Number of elements in a batch of MongoDB IN query
     * @returns {boolean}
     */
    get mongoInQueryIdBatchSize() {
        return env.MONGO_IN_QUERY_BATCH_SIZE ? parseInt(env.MONGO_IN_QUERY_BATCH_SIZE) : 100;
    }

    /**
     * List of clients with data connection view control enabled
     * @returns {string[]}
     */
    get clientsWithDataConnectionViewControl() {
        return (
            (env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL &&
                env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL.split(',').map((col) => col.trim())) || []
        );
    }

    /**
     * True if Datadog is enabled, false if opentelemetry is enabled
     * @returns {boolean}
     */
    get isDataDogEnabled() {
        if (env.DD_TRACE_ENABLED === null || env.DD_TRACE_ENABLED === undefined) {
            return false;
        }
        return isTrue(env.DD_TRACE_ENABLED);
    }

    /**
     * return AUTH_JWKS_URL
     * @returns {string}
     */
    get authJwksUrl() {
        return env.AUTH_JWKS_URL || '';
    }

    /**
     * Return EXTERNAL_REQUEST_TIMEOUT_SEC
     * @returns {number}
     */
    get externalRequestTimeoutSec() {
        return env.EXTERNAL_REQUEST_TIMEOUT_SEC ? parseInt(env.EXTERNAL_REQUEST_TIMEOUT_SEC) : 30;
    }

    /**
     * return EXTERNAL_AUTH_JWKS_URLS
     * @returns {string[]}
     */
    get externalAuthJwksUrls() {
        return env.EXTERNAL_AUTH_JWKS_URLS ? env.EXTERNAL_AUTH_JWKS_URLS.split(',') : [];
    }

    /**
     * return EXTERNAL_AUTH_WELL_KNOWN_URLS
     * @returns {string[]}
     */
    get externalAuthWellKnownUrls() {
        return env.EXTERNAL_AUTH_WELL_KNOWN_URLS ? env.EXTERNAL_AUTH_WELL_KNOWN_URLS.split(',') : [];
    }

    /**
     * return AUTH_CUSTOM_SCOPE
     * @returns {string[]}
     */
    get authCustomScope() {
        return env.AUTH_CUSTOM_SCOPE ? env.AUTH_CUSTOM_SCOPE.split(',') : [];
    }

    /**
     * return AUTH_CUSTOM_GROUP
     * @returns {string[]}
     */
    get authCustomGroup() {
        return env.AUTH_CUSTOM_GROUP ? env.AUTH_CUSTOM_GROUP.split(',') : [];
    }

    /**
     * return AUTH_CUSTOM_USERNAME
     * @returns {string[]}
     */
    get authCustomUserName() {
        return env.AUTH_CUSTOM_USERNAME ? env.AUTH_CUSTOM_USERNAME.split(',') : [];
    }

    /**
     * return AUTH_CUSTOM_SUBJECT
     * @returns {string[]}
     */
    get authCustomSubject() {
        return env.AUTH_CUSTOM_SUBJECT ? env.AUTH_CUSTOM_SUBJECT.split(',') : [];
    }

    /**
     * return AUTH_CUSTOM_CLIENT_ID
     * @returns {string[]}
     */
    get authCustomClientId() {
        return env.AUTH_CUSTOM_CLIENT_ID ? env.AUTH_CUSTOM_CLIENT_ID.split(',') : [];
    }

    /**
     * return CACHE_EXPIRY_TIME
     * @returns {number}
     */
    get cacheExpiryTime() {
        return env.CACHE_EXPIRY_TIME ? parseInt(env.CACHE_EXPIRY_TIME) : DEFAULT_CACHE_EXPIRY_TIME; // 1 hour
    }

    /**
     * return REDIRECT_TO_LOGIN
     * @returns {boolean}
     */
    get redirectToLogin() {
        if (env.REDIRECT_TO_LOGIN === null || env.REDIRECT_TO_LOGIN === undefined) {
            return false;
        }
        return isTrue(env.REDIRECT_TO_LOGIN);
    }
}

module.exports = {
    ConfigManager
};
