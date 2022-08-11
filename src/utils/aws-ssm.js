const AWS = require('aws-sdk');
const REGION = process.env.AWS_REGION || 'us-east-1';

const ssm = new AWS.SSM({
    region: REGION,
});

/**
 * @param {string} environment
 * @returns {{username: string, password: string}}
 */
module.exports.getElasticSearchParameterAsync = async (environment) => {
    const username = await ssm.getParameter({
        Name: `${environment}/helix/elasticsearch/username`,
        WithDecryption: false
    }).promise();
    const password = await ssm.getParameter({
        Name: `${environment}/helix/elasticsearch/password`,
        WithDecryption: false
    }).promise();
    return {username, password};
};
