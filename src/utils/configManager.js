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
     * whether to check access tags on save
     * @return {boolean}
     */
    get checkAccessTagsOnSave() {
        if (env.CHECK_ACCESS_TAG_ON_SAVE === null || env.CHECK_ACCESS_TAG_ON_SAVE === undefined) {
            return true;
        }
        return isTrue(env.CHECK_ACCESS_TAG_ON_SAVE);
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
    get graphBatchSize(){
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
     * Whether access tags needs to be updated for resources
     */
    get enabledSensitiveDataAccessUpdate() {
        return isTrue(env.ENABLE_SENSITIVE_DATA_ACCESS_UPDATE);
    }

    /**
     * Whether the resources needs to be updated after changes have been made to access tag
     */
    get updateResources() {
        return isTrue(env.UPDATE_SECURITY_TAGS);
    }
}

module.exports = {
    ConfigManager
};
