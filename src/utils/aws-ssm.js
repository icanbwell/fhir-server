const AWS = require('aws-sdk');
const {assertIsValid} = require('./assertType');
const REGION = process.env.AWS_REGION || 'us-east-1';

const ssm = new AWS.SSM({
    region: REGION,
});

/**
 * Gets username and password for ElasticSearch
 * @param environment
 * @return {Promise<{password: string, username: string}>}
 */
module.exports.getElasticSearchParameterAsync = async (environment) => {
    assertIsValid(environment);
    assertIsValid(typeof environment === 'string');

    /**
     * @type {import('aws-sdk').SSM.GetParameterResult}}
     */
    const usernameParameter = await ssm.getParameter({
        Name: `/${environment}/fhir-server/elasticsearch/username`,
        WithDecryption: true
    }).promise();
    /**
     * @type {import('aws-sdk').SSM.GetParameterResult}}
     */
    const passwordParameter = await ssm.getParameter({
        Name: `/${environment}/fhir-server/elasticsearch/password`,
        WithDecryption: true
    }).promise();
    return {username: usernameParameter.Parameter.Value, password: passwordParameter.Parameter.Value};
};
