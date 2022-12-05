const env = require('var');
const {assertIsValid} = require('../utils/assertType');
const {getElasticSearchParameterAsync} = require('../utils/aws-ssm');
const {Client} = require('@opensearch-project/opensearch');

class AdminLogManager {

    /**
     * gets lgos
     * @param id
     * @returns {Promise<Object[]>}
     */
    async getLogAsync(id) {
        if (!env.LOG_ELASTIC_SEARCH_URL){
            return [];
        }
        // https://vpc-prod-shared-elasticsearch-o7pgs5fwj7yxm5kylp5flpbkza.us-east-1.es.amazonaws.com/
        // fhir-staging-logs-*/_search?q=020c89c4-dfb9-49a0-acc7-ef8c42ebcce6

        let node = env.LOG_ELASTIC_SEARCH_URL;
        assertIsValid(node, 'LOG_ELASTIC_SEARCH_URL environment variable is not defined but LOG_ELASTIC_SEARCH_ENABLE is set');
        console.info(JSON.stringify({message: `Reading from ${node}`}));
        if (env.LOG_ELASTIC_SEARCH_USERNAME !== undefined && env.LOG_ELASTIC_SEARCH_PASSWORD !== undefined) {
            node = node.replace('https://', `https://${env.LOG_ELASTIC_SEARCH_USERNAME}:${env.LOG_ELASTIC_SEARCH_PASSWORD}@`);
        } else {
            const {username, password} = await getElasticSearchParameterAsync(env.ENV);
            assertIsValid(username);
            assertIsValid(typeof username === 'string');
            assertIsValid(password);
            assertIsValid(typeof password === 'string');
            console.info(JSON.stringify({message: `Reading from ${node} with username: ${username}`}));
            node = node.replace('https://', `https://${username}:${password}@`);
        }

        /**
         * @type {Client}
         */
        const client = new Client({
            node: node,
            ssl: {
                rejectUnauthorized: env.NODE_ENV !== 'development' // skip cert verification on local
            }
        });

        const indexPrefix = env.LOG_ELASTIC_SEARCH_PREFIX ?
            String(env.LOG_ELASTIC_SEARCH_PREFIX).toLowerCase() + '-*' :
            'logs';

        const body = {
            query: {
                term: {
                    'fields.id.keyword': id
                }
            }
        };
        console.log(`Searching in index ${indexPrefix} for ${JSON.stringify(body)}`);

        try {
            // Let's search!
            const result = await client.search({
                index: indexPrefix,
                body
            });

            console.log(`result=${JSON.stringify(result)}`);
            console.log(`body=${JSON.stringify(result.body)}`);
            console.log(`body hits=${JSON.stringify(result.body.hits)}`);
            console.log(`body hits hits=${JSON.stringify(result.body.hits.hits)}`);

            return result.body.hits.hits;
        } catch (e) {
            console.error(`error ${e} ${e.message} json=${JSON.stringify(e)}`);
        }
        return [];
    }
}

module.exports = {
    AdminLogManager
};
