const {GetSecretValueCommand} = require('@aws-sdk/client-secrets-manager');
const {assertTypeEquals} = require('./assertType');
const {AwsSecretsClientFactory} = require('./awsSecretsClientFactory');

class AwsSecretsManager {
    /**
     * constructor
     * @param {AwsSecretsClientFactory} secretsManagerClientFactory
     */
    constructor(
        {
            secretsManagerClientFactory
        }
    ) {
        this.secretsManagerClientFactory = secretsManagerClientFactory;
        assertTypeEquals(secretsManagerClientFactory, AwsSecretsClientFactory);
    }

    /**
     * @param {string} secretName
     */
    async getSecretValueAsync({secretName}) {
        var input = {SecretId: secretName};
        const command = new GetSecretValueCommand(input);
        /**
         * @type {import('@aws-sdk/client-secrets-manager').SecretsManagerClient}
         */
        const secretsManagerClient = await this.secretsManagerClientFactory.createSecretsClientAsync();
        const response = await secretsManagerClient.send(command);
        const secretString = response.SecretString;
        const {username, password} = JSON.parse(secretString);
        return {username, password};
    }
}

module.exports = {
    AwsSecretsManager
};
