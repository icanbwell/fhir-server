const { logInfo } = require('../operations/common/logging');

module.exports.createK8Job = async (fnGetContainer, req, res) => {
    try {
        const k8sClient = fnGetContainer().k8sClient;
        const scriptPath = 'src/fhir/hello-world.js';
        logInfo('K8s job api');
        const job = await k8sClient.createJob(scriptPath);
        logInfo('K8s job trigered');
        res.status(200).json(job);
    } catch (error) {
        logInfo('git error');
        res.status(500).json({ error: error.message });
    }
};
