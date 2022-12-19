const {GetSecretValueCommand} = require('@aws-sdk/client-secrets-manager');
const {assertTypeEquals} = require('./assertType');
const {AwsSecretsClientFactory} = require('./awsSecretsClientFactory');
const {RethrownError} = require('./rethrownError');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

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
        /**
         * @type {AwsSecretsClientFactory}
         */
        this.secretsManagerClientFactory = secretsManagerClientFactory;
        assertTypeEquals(secretsManagerClientFactory, AwsSecretsClientFactory);

        /**
         * This is a Map where the key is secret name and the value is result
         * @type {Map<string, string>}
         */
        this.mapCache = new Map();
    }

    /**
     * @param {string} secretName
     */
    async getSecretValueAsync({secretName}) {
        await mutex.runExclusive(async () => {
                try {
                    /**
                     * @type {string}
                     */
                    let secretString;
                    if (this.mapCache.has(secretName)) {
                        secretString = this.mapCache.get(secretName);
                    } else {
                        var input = {SecretId: secretName};
                        const command = new GetSecretValueCommand(input);
                        /**
                         * @type {import('@aws-sdk/client-secrets-manager').SecretsManagerClient}
                         */
                        const secretsManagerClient = await this.secretsManagerClientFactory.createSecretsClientAsync();
                        /**
                         * @type {import('@aws-sdk/client-secrets-manager').GetSecretValueCommandOutput}
                         */
                        const response = await secretsManagerClient.send(command);
                        secretString = response.SecretString;
                        this.mapCache.set(secretName, secretString);
                    }
                    const {username, password} = JSON.parse(secretString);
                    return {username, password};
                } catch (e) {
                    throw new RethrownError(
                        {
                            message: `Error retrieving AWS secret ${secretName}`,
                            error: e,
                            args: {
                                secret: secretName
                            },
                            source: 'AwsSecretManager.getSecretValueAsync'
                        }
                    );
                }
            }
        );
    }
}

module.exports = {
    AwsSecretsManager
};
