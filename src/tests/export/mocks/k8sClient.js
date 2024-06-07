const { K8sClient } = require('../../../utils/k8sClient');

class MockK8sClient extends K8sClient {
    init() {
        // do nothing
    }

    createJob() {
        // do nothing
    }

    createJobBody() {
        // do nothing
    }
}

module.exports = { MockK8sClient };
