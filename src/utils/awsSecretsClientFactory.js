const {SecretsManagerClient} = require('@aws-sdk/client-secrets-manager');

class AwsSecretsClientFactory {
    /**
     * create client
     * @return {SecretsManagerClient}
     */
    async createSecretsClientAsync() {
        return new SecretsManagerClient({region: 'us-east-1'});
    }
}

module.exports = {
    AwsSecretsClientFactory
};
