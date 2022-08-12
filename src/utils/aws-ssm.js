const AWS = require('aws-sdk');
const REGION = process.env.AWS_REGION || 'us-east-1';
const assert = require('node:assert/strict');

const ssm = new AWS.SSM({
    region: REGION,
});

/**
 * @param {string} environment
 * @returns {{username: string, password: string}}
 */
module.exports.getElasticSearchParameterAsync = async (environment) => {
    assert(environment);
    assert(typeof environment === 'string');

    /**
     * @type {import('aws-sdk').SSM.GetParameterResult}}
     */
    const usernameParameter = await ssm.getParameter({
        Name: `/${environment}/helix/elasticsearch/username`,
        WithDecryption: false
    }).promise();
    /**
     * @type {import('aws-sdk').SSM.GetParameterResult}}
     */
    const passwordParameter = await ssm.getParameter({
        Name: `/${environment}/helix/elasticsearch/password`,
        WithDecryption: false
    }).promise();
    return {username: usernameParameter.Parameter.Value, password: passwordParameter.Parameter.Value};
};
