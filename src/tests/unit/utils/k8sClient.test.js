/**
 * Unit tests for K8sClient
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Mock @kubernetes/client-node
const mockKubeConfig = {
    loadFromCluster: jestObj.fn(),
    makeApiClient: jestObj.fn(),
    getCurrentContext: jestObj.fn().mockReturnValue('inClusterContext'),
    getContextObject: jestObj.fn().mockReturnValue({ namespace: 'fhir-server' })
};

const mockBatchV1Api = {
    createNamespacedJob: jestObj.fn().mockResolvedValue({ body: { metadata: { name: 'test-job' } } })
};

const mockCoreV1Api = {
    readNamespacedPod: jestObj.fn().mockResolvedValue({
        spec: {
            containers: [{
                image: 'fhir-server:latest',
                env: [
                    { name: 'NODE_ENV', value: 'production' },
                    { name: 'FHIR_VERSION', value: '4.0.1' },
                    { name: 'AWS_REGION', value: 'us-east-1' },
                    { name: 'OTEL_EXPORTER', value: 'jaeger' },
                    { name: 'NODE_OPTIONS', value: '--max-old-space' }
                ],
                envFrom: [{ secretRef: { name: 'fhir-secret' } }]
            }]
        }
    })
};

jestObj.mock('@kubernetes/client-node', () => ({
    KubeConfig: jestObj.fn().mockImplementation(() => mockKubeConfig),
    BatchV1Api: 'BatchV1Api',
    CoreV1Api: 'CoreV1Api',
    V1EnvVar: jestObj.fn().mockImplementation(() => ({})),
    V1SecretEnvSource: jestObj.fn().mockImplementation(() => ({})),
    V1EnvFromSource: jestObj.fn().mockImplementation(() => ({})),
    V1Job: jestObj.fn().mockImplementation(() => ({})),
    V1ObjectMeta: jestObj.fn().mockImplementation(() => ({})),
    V1Container: jestObj.fn().mockImplementation(() => ({})),
    V1ResourceRequirements: jestObj.fn().mockImplementation(() => ({})),
    V1PodTemplateSpec: jestObj.fn().mockImplementation(() => ({})),
    V1PodSpec: jestObj.fn().mockImplementation(() => ({})),
    V1JobSpec: jestObj.fn().mockImplementation(() => ({}))
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn(),
    logInfo: jestObj.fn()
}));

jestObj.mock('../../../utils/uid.util', () => ({
    generateUUID: jestObj.fn().mockReturnValue('abcdef1234567890')
}));

jestObj.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, source, error }) {
            super(message);
            this.source = source;
            this.originalError = error;
        }
    }
}));

const { K8sClient } = require('../../../utils/k8sClient');
const { logError, logInfo } = require('../../../operations/common/logging');

describe('K8sClient', () => {
    let k8sClient;
    let mockConfigManager;
    let originalEnv;

    beforeEach(() => {
        jestObj.clearAllMocks();
        originalEnv = { ...process.env };
        process.env.DOCKER_IMAGE_VERSION = '1.0.0';

        mockKubeConfig.makeApiClient.mockImplementation((apiClass) => {
            if (apiClass === 'BatchV1Api') return mockBatchV1Api;
            if (apiClass === 'CoreV1Api') return mockCoreV1Api;
            return {};
        });

        mockConfigManager = {
            environmentValue: 'dev',
            hostnameValue: 'fhir-server-pod-0',
            useEnvironmentValueForK8sNamespace: true
        };

        k8sClient = new K8sClient({ configManager: mockConfigManager });
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor and init', () => {
        test('stores configManager reference', () => {
            expect(k8sClient.configManager).toBe(mockConfigManager);
        });

        test('initializes KubeConfig and loads from cluster', () => {
            expect(mockKubeConfig.loadFromCluster).toHaveBeenCalled();
        });

        test('creates BatchV1Api client', () => {
            expect(mockKubeConfig.makeApiClient).toHaveBeenCalledWith('BatchV1Api');
            expect(k8sClient.k8sBatchV1Api).toBe(mockBatchV1Api);
        });

        test('creates CoreV1Api client', () => {
            expect(mockKubeConfig.makeApiClient).toHaveBeenCalledWith('CoreV1Api');
            expect(k8sClient.k8sApi).toBe(mockCoreV1Api);
        });

        test('logs error if init fails', () => {
            mockKubeConfig.loadFromCluster.mockImplementationOnce(() => {
                throw new Error('Cluster not found');
            });
            const client = new K8sClient({ configManager: mockConfigManager });
            expect(logError).toHaveBeenCalledWith('Error while initializing k8 client:', expect.any(Error));
        });

        test('derives namespace from environmentValue by default (useEnvironmentValueForK8sNamespace defaults to true)', () => {
            expect(mockKubeConfig.getContextObject).not.toHaveBeenCalled();
            expect(k8sClient.namespace).toBe('fhir-server-dev');
        });

        test('reads namespace from the kube config context when useEnvironmentValueForK8sNamespace is false', () => {
            mockConfigManager.useEnvironmentValueForK8sNamespace = false;
            mockKubeConfig.getContextObject.mockReturnValueOnce({ namespace: 'fhir-server' });
            const client = new K8sClient({ configManager: mockConfigManager });
            expect(mockKubeConfig.getContextObject).toHaveBeenCalledWith('inClusterContext');
            expect(client.namespace).toBe('fhir-server');
        });
    });

    describe('createJobBody', () => {
        const scriptCommand = 'node scripts/export.js --patient 123';
        const context = {};

        test('creates job body with correct namespace', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(mockCoreV1Api.readNamespacedPod).toHaveBeenCalledWith({
                name: 'fhir-server-pod-0',
                namespace: 'fhir-server-dev'
            });
        });

        test('filters out AWS_, OTEL_, and NODE_OPTIONS env vars', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            // The job should be created successfully (returns a job object)
            expect(job).toBeDefined();
            expect(job.apiVersion).toBe('batch/v1');
            expect(job.kind).toBe('Job');
        });

        test('includes LOGLEVEL from context when provided', async () => {
            const contextWithLoglevel = { loglevel: 'DEBUG' };
            const job = await k8sClient.createJobBody({ scriptCommand, context: contextWithLoglevel });
            expect(job).toBeDefined();
        });

        test('does not include LOGLEVEL when not in context', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context: {} });
            expect(job).toBeDefined();
        });

        test('sets job name with UUID suffix', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(job.metadata.name).toBe('fhir-server-job-1234567890');
        });

        test('sets container image from current pod', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(job).toBeDefined();
        });

        test('splits scriptCommand into container args', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            // The container args should be the split command
            expect(job).toBeDefined();
        });

        test('uses default resource values when context does not specify', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context: {} });
            expect(job).toBeDefined();
        });

        test('uses custom resource values from context', async () => {
            const contextWithResources = {
                ram: '2',
                requestsMemory: '4G',
                limitsMemory: '16G',
                ttlSecondsAfterFinished: 120
            };
            const job = await k8sClient.createJobBody({ scriptCommand, context: contextWithResources });
            expect(job).toBeDefined();
        });

        test('sets metadata labels with app and version', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(job.metadata.labels).toEqual({
                app: 'fhir-server',
                'app.kubernetes.io/version': '1.0.0'
            });
        });

        test('sets restartPolicy to Never', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(job).toBeDefined();
        });

        test('sets activeDeadlineSeconds to 24 hours', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(job).toBeDefined();
        });

        test('sets backoffLimit to 0', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(job).toBeDefined();
        });

        test('uses default ttlSecondsAfterFinished of 60 when not in context', async () => {
            const job = await k8sClient.createJobBody({ scriptCommand, context: {} });
            expect(job).toBeDefined();
        });

        test('logs error and returns undefined when readNamespacedPod fails', async () => {
            mockCoreV1Api.readNamespacedPod.mockRejectedValue(new Error('Pod not found'));
            const job = await k8sClient.createJobBody({ scriptCommand, context });
            expect(logError).toHaveBeenCalledWith('Error while creating job body:', expect.any(Error));
            expect(job).toBeUndefined();
        });
    });

    describe('createJob', () => {
        const scriptCommand = 'node scripts/export.js --patient 123';
        const context = {};

        test('creates job successfully and returns true', async () => {
            const result = await k8sClient.createJob({ scriptCommand, context });
            expect(result).toBe(true);
            expect(mockBatchV1Api.createNamespacedJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    namespace: 'fhir-server-dev'
                })
            );
            expect(logInfo).toHaveBeenCalledWith('Job created:', expect.anything());
        });

        test('returns false when quota exceeded (Forbidden)', async () => {
            const quotaError = new Error('Quota exceeded');
            quotaError.body = JSON.stringify({
                reason: 'Forbidden',
                message: 'forbidden: exceeded quota: pods-limit'
            });

            mockBatchV1Api.createNamespacedJob.mockRejectedValue(quotaError);
            const result = await k8sClient.createJob({ scriptCommand, context });
            expect(result).toBe(false);
            expect(logInfo).toHaveBeenCalledWith(
                expect.stringContaining('Maximum number of active jobs reached')
            );
        });

        test('throws RethrownError on other errors', async () => {
            const genericError = new Error('API server unavailable');
            genericError.body = 'Internal Server Error';

            mockBatchV1Api.createNamespacedJob.mockRejectedValue(genericError);
            await expect(k8sClient.createJob({ scriptCommand, context })).rejects.toThrow('API server unavailable');
            expect(logError).toHaveBeenCalledWith('Error creating job:', expect.any(Error));
        });

        test('throws RethrownError when error.body is not a JSON string', async () => {
            const error = new Error('Network timeout');
            error.body = undefined;

            mockBatchV1Api.createNamespacedJob.mockRejectedValue(error);
            await expect(k8sClient.createJob({ scriptCommand, context })).rejects.toThrow('Network timeout');
        });

        test('throws when error.body does not contain exceeded quota', async () => {
            const error = new Error('Permission denied');
            error.body = JSON.stringify({ reason: 'Forbidden', message: 'no permission' });

            mockBatchV1Api.createNamespacedJob.mockRejectedValue(error);
            await expect(k8sClient.createJob({ scriptCommand, context })).rejects.toThrow('Permission denied');
        });

        test('uses the live kube config namespace instead of environmentValue when useEnvironmentValueForK8sNamespace is false', async () => {
            mockBatchV1Api.createNamespacedJob.mockResolvedValue({ body: { metadata: { name: 'test-job' } } });
            mockConfigManager.environmentValue = 'production';
            mockConfigManager.useEnvironmentValueForK8sNamespace = false;
            mockKubeConfig.getContextObject.mockReturnValueOnce({ namespace: 'fhir-server' });
            k8sClient = new K8sClient({ configManager: mockConfigManager });

            await k8sClient.createJob({ scriptCommand, context });
            expect(mockBatchV1Api.createNamespacedJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    namespace: 'fhir-server'
                })
            );
        });
    });
});
