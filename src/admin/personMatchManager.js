const {assertTypeEquals, assertIsValid} = require('../utils/assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const superagent = require('superagent');
const {ConfigManager} = require('../utils/configManager');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const {logInfo} = require('../operations/common/logging');
const { EXTERNAL_REQUEST_RETRY_COUNT } = require('../constants');

class PersonMatchManager {
    /**
     *
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            databaseQueryFactory,
            configManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * matches persons
     * @param {string} sourceId
     * @param {string|undefined} sourceType
     * @param {string} targetId
     * @param {string|undefined} targetType
     * @return {Promise<Object>}
     */
    async personMatchAsync(
        {
            sourceId,
            sourceType,
            targetId,
            targetType
        }
    ) {
        /**
         * @type {string}
         */
        sourceType = sourceType || 'Patient';
        /**
         * @type {string}
         */
        targetType = targetType || 'Patient';
        // strip resourceType
        if (sourceId.includes('/')) {
            sourceType = sourceId.split('/')[0];
            sourceId = sourceId.split('/')[1];
        }
        if (targetId.includes('/')) {
            targetType = targetId.split('/')[0];
            targetId = targetId.split('/')[1];
        }
        const patientDatabaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Patient',
            base_version: '4_0_0'
        });

        const personDatabaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });

        const source = sourceType === 'Patient' ?
            await patientDatabaseQueryManager.findOneAsync({
                query: {_uuid: sourceId}
            }) :
            await personDatabaseQueryManager.findOneAsync({
                query: {_uuid: sourceId}
            });
        const target = targetType === 'Patient' ?
            await patientDatabaseQueryManager.findOneAsync({
                query: {_uuid: targetId}
            }) :
            await personDatabaseQueryManager.findOneAsync({
                query: {_uuid: targetId}
            });
        if (!source) {
            return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'not-found',
                                diagnostics: `Resource with type:${sourceType} and id:${sourceId} was not found`
                            }
                        )
                    ]
                }
            ).toJSON();
        }
        if (!target) {
            return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'not-found',
                                diagnostics: `Resource with type:${targetType} and id:${targetId} was not found`
                            }
                        )
                    ]
                }
            ).toJSON();
        }
        if (source && target) {
            const parameters = {
                'resourceType': 'Parameters',
                'parameter': [
                    {
                        'name': 'resource',
                        'resource': source.toJSON(),
                    },
                    {
                        'name': 'match',
                        'resource': target.toJSON()
                    }
                ]
            };

            const url = this.configManager.personMatchingServiceUrl;
            assertIsValid(url, 'PERSON_MATCHING_SERVICE_URL environment variable is not set');
            // post to $match service
            const header = {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            };
            logInfo(`Calling ${url} with body`, {'body': parameters});
            try {
                /**
                 * @type {request.Response}
                 */
                const res = await superagent
                .post(url)
                .send(parameters)
                .set(header)
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(this.configManager.requestTimeoutMs);
                const json = res.body;
                logInfo('', {json});
                return json;
            } catch (error) {
                if (error.timeout) {
                    return new OperationOutcome({
                        issue: [
                            new OperationOutcomeIssue({
                                    severity: 'error',
                                    code: 'timeout',
                                    diagnostics: `Request timeout out while sending request to personMatchingService for source: ${source}, target: ${target}`,
                                }
                            )
                        ]
                    }).toJSON();
                }
                throw error;
            }
        }
    }
}

module.exports = {
    PersonMatchManager
};
