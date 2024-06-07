const env = require('var');
const { isTrue } = require('./isTrue');

class ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources () {
        // see if resourceType is in list of resources we want to partitionConfig in this environment
        /**
         * @type {string|undefined}
         */
        const partitionResourcesString = env.PARTITION_RESOURCES;
        return partitionResourcesString
            ? partitionResourcesString.split(',').map(s => String(s).trim()) : [];
    }

    get resourcesWithAccessIndex () {
        return (
            env.COLLECTIONS_ACCESS_INDEX && env.COLLECTIONS_ACCESS_INDEX.split(',')
                .map((col) => col.trim())
        ) || [];
    }

    get useAccessIndex () {
        return isTrue(env.USE_ACCESS_INDEX);
    }

    /**
     * @return {string[]|null}
     */
    get requiredFiltersForAuditEvent () {
        return (
            env.REQUIRED_AUDIT_EVENT_FILTERS && env.REQUIRED_AUDIT_EVENT_FILTERS.split(',')
                .map((col) => col.trim())
        ) || null;
    }

    /**
     * @description The max range period for which AuditEvent is to queried.
     * @return {number}
     */
    get auditEventMaxRangePeriod () {
        return env.AUDIT_EVENT_MAX_RANGE_PERIOD ? Number(env.AUDIT_EVENT_MAX_RANGE_PERIOD) : 30;
    }

    /**
     * whether to enable two step optimization
     * @return {boolean}
     */
    get enableTwoStepOptimization () {
        return isTrue(env.USE_TWO_STEP_SEARCH_OPTIMIZATION);
    }

    /**
     * whether to stream the response
     * @return {boolean}
     */
    get streamResponse () {
        return isTrue(env.STREAM_RESPONSE);
    }

    get doNotRequirePersonOrPatientIdForPatientScope () {
        return isTrue(env.DO_NOT_REQUIRE_PERSON_OR_PATIENT_FOR_PATIENT_SCOPE);
    }

    /**
     * current environment value
     * @return {string|null}
     */
    get environmentValue () {
        return env.ENVIRONMENT || '';
    }

    /**
     * current hostname value
     * @return {string|null}
     */
    get hostnameValue () {
        return env.HOSTNAME || '';
    }

    /**
     * docker image
     * @return {string|null}
     */
    get dockerImageValue () {
        return env.DOCKER_IMAGE || '';
    }

    /**
     * @returns {string[]}
     */
    get accessTagsIndexed () {
        let indexList = (
            env.ACCESS_TAGS_INDEXED && env.ACCESS_TAGS_INDEXED.split(',')
                .map((col) => col.trim())
        ) || [];
        indexList = indexList.concat(
            (
                env.ACCESS_TAGS_INDEXED_ENCOUNTER && env.ACCESS_TAGS_INDEXED_ENCOUNTER.split(',')
                    .map((col) => col.trim())
            ) || []
        );
        indexList = indexList.concat(
            (
                env.ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT && env.ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT.split(',')
                    .map((col) => col.trim())
            ) || []
        );
        indexList = indexList.concat(
            (
                env.ACCESS_TAGS_INDEXED_PRACTITIONER_ROLE && env.ACCESS_TAGS_INDEXED_PRACTITIONER_ROLE.split(',')
                    .map((col) => col.trim())
            ) || []
        );
        return indexList;
    }

    /**
     * username for kafka auth
     * @return {string|null}
     */
    get kafkaUserName () {
        return env.KAFKA_SASL_USERNAME || null;
    }

    /**
     * password for kafka auth
     * @return {string|null}
     */
    get kafkaPassword () {
        return env.KAFKA_SASL_PASSWORD || null;
    }

    /**
     * auth mechanism for kafka auth
     * @return {string|undefined}
     */
    get kafkaAuthMechanism () {
        return env.KAFKA_SASL_MECHANISM || 'aws';
    }

    /**
     * sasl identity for kafka auth (UserId or RoleId)
     * @return {string|undefined}
     */
    get kafkaIdentity () {
        return env.KAFKA_SASL_IDENTITY ? env.KAFKA_SASL_IDENTITY : null;
    }

    /**
     * access key for kafka auth
     * @return {string|undefined}
     */
    get kafkaAccessKeyId () {
        return env.KAFKA_SASL_ACCESS_KEY_ID;
    }

    /**
     * access key secret for kafka auth
     * @return {string|undefined}
     */
    get kafkaAccessKeySecret () {
        return env.KAFKA_SASL_ACCESS_KEY_SECRET;
    }

    /**
     * client id for kafka auth
     * @return {string|undefined}
     */
    get kafkaClientId () {
        return env.KAFKA_CLIENT_ID;
    }

    /**
     * get brokers for kafka
     * @return {string[]}
     */
    get kafkaBrokers () {
        return env.KAFKA_URLS ? env.KAFKA_URLS.split(',') : [];
    }

    /**
     * whether to use ssl for kafka
     * @return {boolean}
     */
    get kafkaUseSsl () {
        return isTrue(env.KAFKA_SSL);
    }

    /**
     * whether to use SASL for kafka
     * @return {boolean}
     */
    get kafkaUseSasl () {
        return isTrue(env.KAFKA_SASL);
    }

    /**
     * whether to send events to kafka
     * @return {boolean}
     */
    get kafkaEnableEvents () {
        return isTrue(env.ENABLE_EVENTS_KAFKA);
    }

    /**
     * gets url to person matching service
     * @return {string|undefined}
     */
    get personMatchingServiceUrl () {
        return env.PERSON_MATCHING_SERVICE_URL;
    }

    /**
     * whether to create index when we create a collection
     * @returns {boolean}
     */
    get createIndexOnCollectionCreation () {
        return isTrue(env.CREATE_INDEX_ON_COLLECTION_CREATION);
    }

    /**
     * whether to handle concurrency
     * @return {boolean}
     */
    get handleConcurrency () {
        return !isTrue(env.SKIP_HANDLE_CONCURRENCY);
    }

    /**
     * number to times to retry an update
     * @returns {number}
     */
    get replaceRetries () {
        return env.REPLACE_RETRIES || 10;
    }

    /**
     * whether to return data as bundle
     * @return {boolean}
     */
    get enableReturnBundle () {
        return isTrue(env.RETURN_BUNDLE);
    }

    /**
     * The default sort id currently used
     */
    get defaultSortId () {
        return env.DEFAULT_SORT_ID || '_uuid';
    }

    /**
     * whether to support legacy id support in queries
     * @return {boolean}
     */
    get supportLegacyIds () {
        if (env.SUPPORT_LEGACY_IDS === null || env.SUPPORT_LEGACY_IDS === undefined) {
            return true;
        }
        return isTrue(env.SUPPORT_LEGACY_IDS);
    }

    /**
     * Whether meta.source tags are required
     * @return {boolean}
     */
    get requireMetaSourceTags () {
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
    get graphBatchSize () {
        return env.GRAPH_BATCH_SIZE || 10;
    }

    /**
     * returns enabled gridFs resources list
     * @returns {string[]}
     */
    get enabledGridFsResources () {
        return env.GRIDFS_RESOURCES ? env.GRIDFS_RESOURCES.split(',') : [];
    }

    /**
     * Specifies whether to Consent based data access enabled.
     * @return {boolean}
     */
    get enableConsentedProaDataAccess () {
        return isTrue(env.ENABLE_CONSENTED_PROA_DATA_ACCESS);
    }

    /**
     * Specifies allowed connection types for consent data sharing.
     * @return {string[]}
     */
    get getConsentConnectionTypesList () {
        return env.CONSENT_CONNECTION_TYPES_LIST ? env.CONSENT_CONNECTION_TYPES_LIST.split(',') : ['proa'];
    }

    /**
     * Specifies whether to enable HIE/Treatment related data access.
     * @return {boolean}
     */
    get enableHIETreatmentRelatedDataAccess () {
        return isTrue(env.ENABLE_HIE_TREATMENT_RELATED_DATA_ACCESS);
    }

    /**
     * Specifies allowed connection types for HIE/Treatment related data.
     * @return {string[]}
     */
    get getHIETreatmentConnectionTypesList () {
        return env.HIE_TREATMENT_CONNECTION_TYPES_LIST ? env.HIE_TREATMENT_CONNECTION_TYPES_LIST.split(',') : ['hipaa'];
    }

    /**
     * Specifies "provision.class.code" for the Data sharing Consent
     * @return {string[]}
     */
    get getDataSharingConsentCodes () {
        return env.DATA_SHARING_CONSENT_CODES ? env.DATA_SHARING_CONSENT_CODES.split(',') : ['/dataSharingConsent', '/hipaaConsent'];
    }

    /**
     * Specifies maximum buffer when streaming data
     * https://nodejs.org/docs/latest-v18.x/api/stream.html#buffering
     * @returns {number}
     */
    get streamingHighWaterMark () {
        return env.STREAMING_HIGH_WATER_MARK || 100;
    }

    /**
     * whether to log inside our streaming.  Very verbose so don't set in production
     * @returns {boolean}
     */
    get logStreamSteps () {
        return isTrue(env.LOG_STREAM_STEPS);
    }

    /**
     * url to fhir validation service e.g., http://localhost:8080/fhir/
     * @returns {string|undefined}
     */
    get fhirValidationUrl () {
        return env.FHIR_VALIDATION_URL;
    }

    /**
     * Batch size for parallel fetching/updating profiles in HAPI Fhir
     */
    get batchSizeForRemoteFhir () {
        return Number(env.REMOTE_FHIR_REQUEST_BATCH_SIZE) || 10;
    }

    /**
     * whether to validate schemas
     * @returns {boolean}
     */
    get validateSchema () {
        return isTrue(env.VALIDATE_SCHEMA);
    }

    /**
     * returns the size of payload that should be acceptable
     * @returns {string}
     */
    get payloadLimit () {
        return env.PAYLOAD_LIMIT || '50mb';
    }

    /**
     * returns the request timeout in ms
     * @returns {number}
     */
    get requestTimeoutMs () {
        return (parseInt(env.EXTERNAL_REQUEST_TIMEOUT_SEC) || 30) * 1000;
    }

    /**
     * whether to enable stats endpoint
     * @returns {boolean}
     */
    get enableStatsEndpoint () {
        if (env.ENABLE_STATS_ENDPOINT === null || env.ENABLE_STATS_ENDPOINT === undefined) {
            return false;
        }

        return isTrue(env.ENABLE_STATS_ENDPOINT);
    }

    /**
     * whether to enable graphql playground
     * @returns {boolean}
     */
    get enableGraphQLPlayground () {
        if (env.ENABLE_GRAPHQL_PLAYGROUND === null || env.ENABLE_GRAPHQL_PLAYGROUND === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_GRAPHQL_PLAYGROUND);
    }

    /**
     * whether to enable graphqlv2
     * @returns {boolean}
     */
    get enableGraphQLV2 () {
        if (env.ENABLE_GRAPHQLV2 === null || env.ENABLE_GRAPHQLV2 === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_GRAPHQLV2);
    }

    /**
     * whether to enable graphqlv2 playground
     * @returns {boolean}
     */
    get enableGraphQLV2Playground () {
        if (env.ENABLE_GRAPHQLV2_PLAYGROUND === null || env.ENABLE_GRAPHQLV2_PLAYGROUND === undefined) {
            return false;
        }
        return isTrue(env.ENABLE_GRAPHQLV2_PLAYGROUND);
    }

    /**
     * whether to read audit event data from archive
     * @returns {boolean}
     */
    get enableAuditEventArchiveRead () {
        if (env.AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ === null || env.AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ === undefined) {
            return false;
        }
        return isTrue(env.AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ);
    }

    /**
     * whether to write access logs from middleware
     */
    get enableAccessLogsMiddleware () {
        if (env.ENABLE_ACCESS_LOGS_MIDDLEWARE === null || env.ENABLE_ACCESS_LOGS_MIDDLEWARE === undefined) {
            return true;
        }
        return isTrue(env.ENABLE_ACCESS_LOGS_MIDDLEWARE);
    }

    /**
     * whether to rewrite patient references to proxy-patient reference
     */
    get rewritePatientReference () {
        if (env.REWRITE_PATIENT_REFERENCE === null || env.REWRITE_PATIENT_REFERENCE === undefined) {
            return true;
        }
        return isTrue(env.REWRITE_PATIENT_REFERENCE);
    }

    /**
     * returns number of resources to process in parallel
     * @returns {number}
     */
    get mergeParallelChunkSize () {
        return parseInt(env.MERGE_PARALLEL_CHUNK_SIZE) || 50;
    }

    /**
     * returns cron expression for postRequest processes
     * @returns {string}
     */
    get postRequestFlushTime () {
        // default cron expression is to run the function every 5 sec
        return env.POST_REQUEST_FLUSH_TIME || '*/5 * * * * *';
    }

    /**
     * returns the buffer size for post request processes
     * @returns {number}
     */
    get postRequestBatchSize () {
        return parseInt(env.POST_REQUEST_BATCH_SIZE) || 50;
    }

    /**
     * returns the buffer size for post request processes
     * @returns {number|number}
     */
    get postRequestBufferSize () {
        return parseInt(env.POST_REQUEST_BUFFER_SIZE) || 100;
    }

    /**
     * whether to use clientFhirPersonId from jwt token & raise validation error
     * if patient references in form of lists are updated for patient scope
     */
    get useClientFhirPersonId () {
        if (env.USE_CLIENT_FHIR_PERSON_ID === null || env.USE_CLIENT_FHIR_PERSON_ID === undefined) {
            return false;
        }
        return isTrue(env.USE_CLIENT_FHIR_PERSON_ID);
    }

    /**
     * S3 bucket name to export data to S3
     */
    get bulkExportS3BucketName () {
        return env.BULK_EXPORT_S3_BUCKET_NAME;
    }

    /**
     * Region for AWS services to use
     */
    get awsRegion () {
        return env.AWS_REGION;
    }
}

module.exports = {
    ConfigManager
};
