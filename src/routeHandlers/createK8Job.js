module.exports.createK8Job = async (fnGetContainer, req, res) => {
    try {
        const k8sClient = fnGetContainer().k8sClient;
        const jobManifest = {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: {
                name: 'test-job',
                labels: {
                    app: 'test-job-fhir-server'
                }
            },
            spec: {
                template: {
                    metadata: {
                        name: 'test-job-pod',
                        labels: {
                            app: 'test-job-pod-fhir-server'
                        }
                    },
                    spec: {
                        containers: [
                            {
                                name: 'test-job-container',
                                image: 'busybox',
                                command: ['sh', '-c', 'echo "Hi, testing k8 job creation from fhir-server" && ls']
                            }
                        ],
                        restartPolicy: 'Never'
                    }
                },
                backoffLimit: 2
            }
        };
        const job = await k8sClient.createJob(jobManifest);
        res.status(200).json(job);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
