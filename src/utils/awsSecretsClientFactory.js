const {SecretsManagerClient} = require('@aws-sdk/client-secrets-manager');

class AwsSecretsClientFactory {
    /**
     * create client
     * @return {import('@aws-sdk/client-secrets-manager').SecretsManagerClient}
     */
    async createSecretsClientAsync() {
        return new SecretsManagerClient({region: 'us-east-1'});
    }
}

module.exports = {
    AwsSecretsClientFactory
};
