const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const superagent = require('superagent');
const { ConfigManager } = require('../utils/configManager');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { logInfo } = require('../operations/common/logging');
const { EXTERNAL_REQUEST_RETRY_COUNT } = require('../constants');
const { isUuid, generateUUID } = require('../utils/uid.util');
const { OAuthClientCredentialsHelper } = require('../utils/oauthClientCredentialsHelper');
const { AuditLogger } = require('../utils/auditLogger');
const { PostRequestProcessor } = require('../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');

class PersonMatchManager {
    /**
     *
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     * @param {OAuthClientCredentialsHelper} oauthClientCredentialsHelper
     * @param {AuditLogger} auditLogger
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor (
        {
            databaseQueryFactory,
            configManager,
            oauthClientCredentialsHelper,
            auditLogger,
            postRequestProcessor,
            requestSpecificCache
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

        /**
         * @type {OAuthClientCredentialsHelper}
         */
        this.oauthClientCredentialsHelper = oauthClientCredentialsHelper;
        assertTypeEquals(oauthClientCredentialsHelper, OAuthClientCredentialsHelper);

        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * matches persons
     * @param {string} sourceId
     * @param {string|undefined} sourceType
     * @param {string} targetId
     * @param {string|undefined} targetType
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} [requestInfo]
     * @param {boolean} [includeMatchRequest]
     * @return {Promise<Object>}
     */
    async personMatchAsync (
        {
            sourceId,
            sourceType,
            targetId,
            targetType,
            requestInfo,
            includeMatchRequest
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

        const sourceIdQuery = isUuid(sourceId) ? { _uuid: sourceId } : { id: sourceId };
        const targetIdQuery = isUuid(targetId) ? { _uuid: targetId } : { id: targetId };

        const sourceCursor = sourceType === 'Patient'
            ? await patientDatabaseQueryManager.findAsync({
                query: sourceIdQuery
            })
            : await personDatabaseQueryManager.findAsync({
                query: sourceIdQuery
            });
        const targetCursor = targetType === 'Patient'
            ? await patientDatabaseQueryManager.findAsync({
                query: targetIdQuery
            })
            : await personDatabaseQueryManager.findAsync({
                query: targetIdQuery
            });

        const source = [];
        const target = [];
        while (await sourceCursor.hasNext()) {
            const sourceResource = await sourceCursor.nextObject();
            source.push(sourceResource);
        }
        while (await targetCursor.hasNext()) {
            const targetResource = await targetCursor.nextObject();
            target.push(targetResource);
        }

        if (source.length === 0) {
            return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'not-found',
                                diagnostics: `Resource with type: ${sourceType} and id: ${sourceId} was not found`
                            }
                        )
                    ]
                }
            ).toJSON();
        }
        if (target.length === 0) {
            return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'not-found',
                                diagnostics: `Resource with type: ${targetType} and id: ${targetId} was not found`
                            }
                        )
                    ]
                }
            ).toJSON();
        }
        if (source.length > 1) {
            return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'info',
                                diagnostics: `Multiple resources with type: ${sourceType} and id: ${sourceId} found`
                            }
                        )
                    ]
                }
            ).toJSON();
        }
        if (target.length > 1) {
            return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'info',
                                diagnostics: `Multiple resources with type: ${targetType} and id: ${targetId} found`
                            }
                        )
                    ]
                }
            ).toJSON();
        }

        // Convert Date object to string
        if (source[0].birthDate instanceof Date) {
            source[0].birthDate = source[0].birthDate.toISOString().split('T')[0];
        }
        if (target[0].birthDate instanceof Date) {
            target[0].birthDate = target[0].birthDate.toISOString().split('T')[0];
        }

        const parameters = {
            resourceType: 'Parameters',
            parameter: [
                {
                    name: 'resource',
                    resource: source[0].toJSON()
                },
                {
                    name: 'match',
                    resource: target[0].toJSON()
                }
            ]
        };

        const url = this.configManager.personMatchingServiceUrl;
        assertIsValid(url, 'PERSON_MATCHING_SERVICE_URL environment variable is not set');
        // post to $match service
        const accessToken = await this.oauthClientCredentialsHelper.getAccessTokenAsync();
        const header = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
        };
        const requestId = requestInfo ? requestInfo.requestId : undefined;
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
            if (requestId) {
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await this.auditLogger.logAuditEntryAsync({
                            requestInfo,
                            base_version: '4_0_0',
                            resourceType: sourceType,
                            operation: 'read',
                            args: {},
                            ids: [sourceId]
                        });
                        await this.auditLogger.logAuditEntryAsync({
                            requestInfo,
                            base_version: '4_0_0',
                            resourceType: targetType,
                            operation: 'read',
                            args: {},
                            ids: [targetId]
                        });
                    }
                });
            }
            return includeMatchRequest
                ? { matchRequest: parameters, matchResponse: json }
                : json;
        } catch (error) {
            if (error.timeout) {
                return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                                severity: 'error',
                                code: 'timeout',
                                diagnostics: `Request timeout out while sending request to personMatchingService for source: ${source[0]}, target: ${target[0]}`
                            }
                        )
                    ]
                }).toJSON();
            }
            throw error;
        } finally {
            if (requestId) {
                await this.postRequestProcessor.executeAsync({ requestId });
                await this.requestSpecificCache.clearAsync({ requestId });
            }
        }
    }

    /**
     * Extracts only demographic fields from a FHIR Patient or Person resource.
     * @param {Object} resource - A FHIR resource
     * @returns {Object}
     * @private
     */
    _extractDemographics (resource) {
        const demographics = {};
        if (resource.name) {
            demographics.name = resource.name;
        }
        if (resource.gender) {
            demographics.gender = resource.gender;
        }
        if (resource.birthDate) {
            demographics.birthDate = resource.birthDate instanceof Date
                ? resource.birthDate.toISOString().split('T')[0]
                : resource.birthDate;
        }
        if (resource.telecom) {
            demographics.telecom = resource.telecom;
        }
        if (resource.address) {
            demographics.address = resource.address;
        }
        return demographics;
    }

    /**
     * Performs 1:N person matching
     * @param {string} id
     * @param {string|undefined} resourceType - "Patient" or "Person"
     * @param {string|undefined} matchResourceType - "Patient" or "Person"
     * @param {import('../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {boolean} [includeMatchRequest]
     * @returns {Promise<Object>}
     */
    async personOneToNMatchAsync ({ id, resourceType, matchResourceType, requestInfo, includeMatchRequest }) {
        resourceType = resourceType || 'Patient';
        // strip resourceType from id if provided as "Patient/123"
        if (id.includes('/')) {
            resourceType = id.split('/')[0];
            id = id.split('/')[1];
        }

        if (resourceType !== 'Patient' && resourceType !== 'Person') {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        diagnostics: `resourceType must be "Patient" or "Person", got "${resourceType}"`
                    })
                ]
            }).toJSON();
        }

        if (matchResourceType && matchResourceType !== 'Patient' && matchResourceType !== 'Person') {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        diagnostics: `matchResourceType must be "Patient" or "Person", got "${matchResourceType}"`
                    })
                ]
            }).toJSON();
        }

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType,
            base_version: '4_0_0'
        });

        const idQuery = isUuid(id) ? { _uuid: id } : { id };
        const cursor = await databaseQueryManager.findAsync({ query: idQuery });

        const resources = [];
        while (await cursor.hasNext()) {
            const resource = await cursor.nextObject();
            resources.push(resource);
        }

        if (resources.length === 0) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'not-found',
                        diagnostics: `Resource with type: ${resourceType} and id: ${id} was not found`
                    })
                ]
            }).toJSON();
        }
        if (resources.length > 1) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'info',
                        diagnostics: `Multiple resources with type: ${resourceType} and id: ${id} found`
                    })
                ]
            }).toJSON();
        }

        const demographicResource = this._extractDemographics(resources[0]);
        demographicResource.id = generateUUID();
        demographicResource.resourceType = matchResourceType || resourceType;

        const parameters = {
            id: generateUUID(),
            resourceType: 'Parameters',
            parameter: [
                {
                    name: 'resource',
                    resource: demographicResource
                }
            ]
        };

        const url = this.configManager.personMatchingServiceUrl;
        assertIsValid(url, 'PERSON_MATCHING_SERVICE_URL environment variable is not set');

        logInfo('Sending 1:N patient match request to person-matching service', {});

        const accessToken = await this.oauthClientCredentialsHelper.getAccessTokenAsync();
        const header = {
            'Content-Type': 'application/fhir+json',
            Accept: 'application/fhir+json',
            Authorization: `Bearer ${accessToken}`
        };

        const requestId = requestInfo ? requestInfo.requestId : undefined;
        try {
            const res = await superagent
                .post(url)
                .send(parameters)
                .set(header)
                .retry(EXTERNAL_REQUEST_RETRY_COUNT)
                .timeout(this.configManager.requestTimeoutMs);
            if (requestId) {
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await this.auditLogger.logAuditEntryAsync({
                            requestInfo,
                            base_version: '4_0_0',
                            resourceType,
                            operation: 'read',
                            args: {},
                            ids: [id]
                        });
                    }
                });
            }
            return includeMatchRequest
                ? { matchRequest: parameters, matchResponse: res.body }
                : res.body;
        } catch (error) {
            if (error.timeout) {
                return new OperationOutcome({
                    issue: [
                        new OperationOutcomeIssue({
                            severity: 'error',
                            code: 'timeout',
                            diagnostics: `Request timed out while sending request to person-matching service for 1:N match on ${resourceType}/${id}`
                        })
                    ]
                }).toJSON();
            }
            throw error;
        } finally {
            if (requestId) {
                await this.postRequestProcessor.executeAsync({ requestId });
                await this.requestSpecificCache.clearAsync({ requestId });
            }
        }
    }
}

module.exports = {
    PersonMatchManager
};
