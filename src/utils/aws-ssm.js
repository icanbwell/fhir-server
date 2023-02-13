const {SSM} = require('@aws-sdk/client-ssm');
const {assertIsValid} = require('./assertType');
const REGION = process.env.AWS_REGION || 'us-east-1';

const ssm = new SSM({
    region: REGION,
});

/**
 * @type {string|null}
 */
let elasticSearchUserName = null;
/**
 * @type {string|null}
 */
let elasticSearchPassword = null;

/**
 * Gets username and password for ElasticSearch
 * @param environment
 * @return {Promise<{password: string, username: string}>}
 */
module.exports.getElasticSearchParameterAsync = async (environment) => {
    assertIsValid(environment);
    assertIsValid(typeof environment === 'string');

    if (!elasticSearchUserName || !elasticSearchPassword) {
        /**
         * @type {import('aws-sdk').SSM.GetParameterResult}}
         */
        const usernameParameter = await ssm.getParameter({
            Name: `/${environment}/fhir-server/elasticsearch/username`,
            WithDecryption: true
        });
        /**
         * @type {import('aws-sdk').SSM.GetParameterResult}}
         */
        const passwordParameter = await ssm.getParameter({
            Name: `/${environment}/fhir-server/elasticsearch/password`,
            WithDecryption: true
        });
        elasticSearchUserName = usernameParameter.Parameter.Value;
        elasticSearchPassword = passwordParameter.Parameter.Value;
    }

    return {username: elasticSearchUserName, password: elasticSearchPassword};
};
