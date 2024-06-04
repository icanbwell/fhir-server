const k8s = require('@kubernetes/client-node');
const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { logError, logInfo } = require('../operations/common/logging');
const { generateUUID } = require('./uid.util');


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

        this.init();
    }

    /**
     * function to initialize k8 client
     */
    init () {
        try {
            /**
             * Loading config from cluster
             */
            this.kc = new k8s.KubeConfig();
            this.kc.loadFromCluster();

            /**
             * Create an API client for batch (jobs) operations
             */
            this.k8sBatchV1Api = this.kc.makeApiClient(k8s.BatchV1Api);

            /**
             * Create an API client for core operations
             */
            this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
        } catch (error) {
            logError('Error while initializing k8 client:', error);
        }
    }

    async createJobBody(scriptCommand) {
        try {
            const currentNamespace = `fhir-server-${this.configManager.environmentValue}`;

            // Get the current Pod details
            const readNamespacedPodParam = {
                name: this.configManager.hostnameValue,
                namespace: currentNamespace
            };
            const podDetails = await this.k8sApi.readNamespacedPod(readNamespacedPodParam);
            const currentContainer = podDetails.spec.containers[0];

            // Extract environment variables from the current Pod
            const envVars = currentContainer.env.map(env => {
                const envVar = new k8s.V1EnvVar();
                envVar.name = env.name;
                envVar.value = env.value;
                return envVar;
            });

            // Extract secretEvn
            const secretEnvSource = new k8s.V1SecretEnvSource();
            secretEnvSource.name = currentContainer.envFrom[0].secretRef.name;
            const envFromSource = new k8s.V1EnvFromSource();
            envFromSource.secretRef = secretEnvSource;

            // Create job
            const job = new k8s.V1Job();
            job.apiVersion = 'batch/v1';
            job.kind = 'Job';

            // Set Job name
            const metadata = new k8s.V1ObjectMeta();
            metadata.name = `fhir-server-job-${generateUUID().slice(-10)}`;
            metadata.labels = { app: 'fhir-server' };
            job.metadata = metadata;

            // We need to add container config to the pod as well as to which container we want to start inside the Pod
            const container = new k8s.V1Container();
            container.name = currentNamespace //'fhir-server-k8s-job';
            container.image = currentContainer.image;
            container.env = envVars;
            container.envFrom = [envFromSource];
            const resourceRequirements = new k8s.V1ResourceRequirements();
            resourceRequirements.requests = {
                cpu: '.5',
                memory: '2G'
            };
            resourceRequirements.limits = {
                memory: '8G'
            };
            container.resources = resourceRequirements;
            container.args = scriptCommand.split(' ');

            // Create template
            const template = new k8s.V1PodTemplateSpec();
            const spec = new k8s.V1PodSpec();
            spec.containers = [container];
            spec.restartPolicy = 'Never';
            spec.serviceAccountName = 'fhir-server';
            spec.automountServiceAccountToken = true;
            template.spec = spec;

            template.metadata = new k8s.V1ObjectMeta();
            template.metadata.labels = { app: 'fhir-server' };

            // Create job spec
            const jobSpec = new k8s.V1JobSpec();
            jobSpec.template = template;
            jobSpec.backoffLimit = 0;
            jobSpec.ttlSecondsAfterFinished = 60;
            job.spec = jobSpec;

            return job;
        } catch (error) {
            logError('Error while creating job body:', error);
        }
    }

    async createJob(scriptCommand) {
        try {
            const namespace = `fhir-server-${this.configManager.environmentValue}`;
            const body = await this.createJobBody(scriptCommand);
            const param = {
                namespace,
                body
            }
            const response = await this.k8sBatchV1Api.createNamespacedJob(param);
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
