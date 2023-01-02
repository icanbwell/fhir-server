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
     * name of secret to use to get kafka auth
     * @return {string|null}
     */
    get kafkaAwsSecretName() {
        return env.KAFKA_SASL_AWS_SECRET || null;
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

    get handleConcurrency() {
        return !isTrue(env.SKIP_HANDLE_CONCURRENCY);
    }

    /**
     * number to times to retry an update
     * @returns {*|number}
     */
    get replaceRetries() {
        return env.REPLACE_RETRIES || 10;
    }
}

module.exports = {
    ConfigManager
};
