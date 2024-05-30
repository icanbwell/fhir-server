module.exports.createK8Job = async (fnGetContainer, req, res) => {
    try {
        const k8sClient = fnGetContainer().k8sClient;
        const scriptPath = 'src/fhir/hello-world.js';

        const job = await k8sClient.createJob(scriptPath);
        res.status(200).json(job);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
