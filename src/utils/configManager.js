const env = require('var');
const {isTrue} = require('./isTrue');

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
        return partitionResourcesString ?
            partitionResourcesString.split(',').map(s => String(s).trim()) : [];
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
     * @returns {string[]}
     */
    get accessTagsIndexed() {
        return (
            env.ACCESS_TAGS_INDEXED && env.ACCESS_TAGS_INDEXED.split(',')
                .map((col) => col.trim())
        ) || null;
    }

    /**
     * whether authorization is required
     */
    get authEnabled() {
        return isTrue(env.AUTH_ENABLED);
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
     * sasl identity for kafka auth (UserId or RoleId)
     * @return {string|undefined}
     */
    get kafkaIdentity() {
        return env.KAFKA_SASL_IDENTITY ? env.KAFKA_SASL_IDENTITY : null;
    }

    /**
     * access key for kafka auth
     * @return {string|undefined}
     */
    get kafkaAccessKeyId() {
        return env.KAFKA_SASL_ACCESS_KEY_ID;
    }

    /**
     * access key secret for kafka auth
     * @return {string|undefined}
     */
    get kafkaAccessKeySecret() {
        return env.KAFKA_SASL_ACCESS_KEY_SECRET;
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
     * whether we should log all merges
     * @returns {boolean}
     */
    get logAllMerges() {
        return isTrue(env.LOG_ALL_MERGES);
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
     * whether to enable Global Unique Id support
     * @returns {boolean}
     */
    get enableGlobalIdSupport() {
        if (env.ENABLE_GLOBAL_ID === null || env.ENABLE_GLOBAL_ID === undefined) {
            return true;
        }

        return isTrue(env.ENABLE_GLOBAL_ID);
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
        return env.DEFAULT_SORT_ID || 'id';
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
    get enableConsentedDataAccess() {
        return isTrue(env.ENABLE_CONSENTED_DATA_ACCESS);
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
     * If count requested is higher than this then don't do duplicate removal to save memory
     * @returns {number}
     */
    get streamingMaxCountForDuplicateRemoval() {
        return env.STREAMING_MAX_COUNT_FOR_DUPLICATE_REMOVAL || 1000;
    }

    /**
     * whether to log inside our streaming.  Very verbose so don't set in production
     * @returns {boolean}
     */
    get logStreamSteps() {
        return isTrue(env.LOG_STREAM_STEPS);
    }

    /**
     * whether to show the new UI or the old one
     * @returns {boolean}
     */
    get showNewUI() {
        return isTrue(env.SHOW_NEW_UI);
    }

    /**
     * whether to disable the new UI
     * @returns {boolean}
     * @constructor
     */
    get disableNewUI() {
        return isTrue(env.DISABLE_NEW_UI);
    }

    /**
     * url to fhir validation service e.g., http://localhost:8080/fhir/
     * @returns {string|undefined}
     */
    get fhirValidationUrl() {
        return env.FHIR_VALIDATION_URL;
    }

    /**
     * whether to log validation failures
     * @returns {boolean}
     */
    get logValidationFailures() {
        return isTrue(env.LOG_VALIDATION_FAILURES);
    }

    /**
     * whether to log all saves
     * @returns {boolean}
     */
    get logAllSaves() {
        return isTrue(env.LOG_ALL_SAVES);
    }

    /**
     * whether to validate schemas
     * @returns {boolean}
     */
    get validateSchema() {
        return isTrue(env.VALIDATE_SCHEMA);
    }
}

module.exports = {
    ConfigManager
};
