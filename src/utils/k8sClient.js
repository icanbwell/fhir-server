const k8s = require('@kubernetes/client-node');
const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { logError, logInfo } = require('../operations/common/logging');
const { generateUUID } = require('./uid.util');
const { RethrownError } = require('./rethrownError');

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

    /**
     * Generates the body for creating a Kubernetes Job based on the provided script command.
     *
     * @param {string} scriptCommand - The command to execute in the Job container.
     * @param {Object.<string, string>} context - Context for creating pod for export job
     * @returns {Object} - The body object for creating a Kubernetes Job.
     */
    async createJobBody({ scriptCommand, context }) {
        try {
            const currentNamespace = `fhir-server-${this.configManager.environmentValue}`;

            // Get the current Pod details
            const readNamespacedPodParam = {
                name: this.configManager.hostnameValue,
                namespace: currentNamespace
            };
            const podDetails = await this.k8sApi.readNamespacedPod(readNamespacedPodParam);
            const currentContainer = podDetails.spec.containers[0];

            // Extract environment variables from the current Pod but skip any env varible injected by serviceAccount
            const envVars = currentContainer.env.filter(env => !env.name.startsWith('AWS_')).map(env => {
                const envVar = new k8s.V1EnvVar();
                envVar.name = env.name;
                envVar.value = env.value;
                return envVar;
            });

            // Check if LOGLEVEL exists in context
            if (Object.hasOwn(context, 'loglevel')) {
                const envVar = new k8s.V1EnvVar();
                envVar.name = 'LOGLEVEL';
                envVar.value = context['loglevel'];

                envVars.push(envVar);
            }

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
            metadata.labels = {
                app: 'fhir-server',
                'app.kubernetes.io/version': process.env.DOCKER_IMAGE_VERSION
            };
            job.metadata = metadata;

            // We need to add container config to the pod as well as to which container we want to start inside the Pod
            const container = new k8s.V1Container();
            container.name = currentNamespace;
            container.image = currentContainer.image;
            container.env = envVars;
            container.envFrom = [envFromSource];
            const resourceRequirements = new k8s.V1ResourceRequirements();
            resourceRequirements.requests = {
                cpu: context?.ram ?? '1',
                memory: context?.requestsMemory ?? '2G'
            };
            resourceRequirements.limits = {
                memory: context?.limitsMemory ?? '8G'
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
            spec.activeDeadlineSeconds = 24*60*60; // 24 hours
            template.spec = spec;

            template.metadata = new k8s.V1ObjectMeta();
            template.metadata.labels = { app: 'fhir-server' };

            // Create job spec
            const jobSpec = new k8s.V1JobSpec();
            jobSpec.template = template;
            jobSpec.backoffLimit = 0;
            jobSpec.ttlSecondsAfterFinished = context?.ttlSecondsAfterFinished ?? 60;
            job.spec = jobSpec;

            return job;
        } catch (error) {
            logError('Error while creating job body:', error);
        }
    }

    /**
     * Creates a Kubernetes Job based on the provided script command.
     *
     * @param {string} scriptCommand - The command to execute in the Job container.
     * @param {Object.<string, string>} context - Context for creating pod for export job
     * @returns {Promise<boolean>} - True if the job is created successfully, false if the maximum quota is reached,
     * otherwise throws an error.
     */
    async createJob({ scriptCommand, context }) {
        try {
            const namespace = `fhir-server-${this.configManager.environmentValue}`;
            const body = await this.createJobBody({ scriptCommand, context });
            const param = {
                namespace,
                body
            }
            const response = await this.k8sBatchV1Api.createNamespacedJob(param);
            logInfo('Job created:', response.body);
            return true;
        } catch (error) {
            if (
                typeof error.body === 'string' &&
                error.body.includes('forbidden: exceeded quota') &&
                JSON.parse(error.body)?.reason === 'Forbidden'
            ) {
                logInfo(`Maximum number of active jobs reached in the namespace: ${JSON.parse(error.body)?.message}`);
                return false;
            } else {
                logError('Error creating job:', error);
                throw new RethrownError({
                    message: error.message,
                    source: 'K8sClient.createJob',
                    error: error
                });
            }
        }
    }
}

module.exports = {
    K8sClient
};
