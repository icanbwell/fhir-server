const k8s = require('@kubernetes/client-node');
const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { logError, logInfo } = require('../operations/common/logging');

class K8sClient {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * Loading config from cluster
         */
        this.kc = new k8s.KubeConfig();
        this.kc.loadFromCluster();

        /**
         * Create an API client for batch (jobs) operations
         */
        this.k8sBatchV1Api = this.kc.makeApiClient(k8s.BatchV1Api);
    }

    async createJob(jobManifest) {
        try {
            const namespace = `fhir-server-job-${this.configManager.environmentValue}`;
            const response = await this.k8sBatchV1Api.createNamespacedJob(namespace, jobManifest);
            logInfo('Job created:', response.body);
            return response.body;
        } catch (error) {
            logError('Error creating job:', error);
        }
    }
}

module.exports = {
    K8sClient
};
