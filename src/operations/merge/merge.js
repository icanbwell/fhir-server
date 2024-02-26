const moment = require('moment-timezone');
const { fhirRequestTimer } = require('../../utils/prometheus.utils');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { MergeManager } = require('./mergeManager');
const { DatabaseBulkInserter } = require('../../dataLayer/databaseBulkInserter');
const { DatabaseBulkLoader } = require('../../dataLayer/databaseBulkLoader');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { ScopesManager } = require('../security/scopesManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { ScopesValidator } = require('../security/scopesValidator');
const { BundleManager } = require('../common/bundleManager');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { ParsedArgs } = require('../query/parsedArgs');
const { MergeResultEntry } = require('../common/mergeResultEntry');
const { QueryItem } = require('../graph/queryItem');
const { ConfigManager } = require('../../utils/configManager');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { MergeValidator } = require('./mergeValidator');
const { PostSaveProcessor } = require('../../dataLayer/postSaveProcessor');

class MergeOperation {
    /**
     * @param {MergeManager} mergeManager
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {PostSaveProcessor} postSaveProcessor
     * @param {DatabaseBulkLoader} databaseBulkLoader
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ScopesManager} scopesManager
     * @param {FhirLoggingManager} fhirLoggingManager
     * @param {ScopesValidator} scopesValidator
     * @param {BundleManager} bundleManager
     * @param {ConfigManager} configManager
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {MergeValidator} mergeValidator
     */
    constructor (
        {
            mergeManager,
            databaseBulkInserter,
            postSaveProcessor,
            databaseBulkLoader,
            postRequestProcessor,
            scopesManager,
            fhirLoggingManager,
            scopesValidator,
            bundleManager,
            configManager,
            bwellPersonFinder,
            mergeValidator
        }
    ) {
        /**
         * @type {MergeManager}
         */
        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
        /**
         * @type {DatabaseBulkLoader}
         */
        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
        /**
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {MergeValidator}
         */
        this.mergeValidator = mergeValidator;
        assertTypeEquals(mergeValidator, MergeValidator);
    }

    /**
     * Add successful merges
     * @param {Resource[]} resourcesIncomingArray
     * @param {MergeResultEntry[]} currentMergeResults
     * @return {MergeResultEntry[]}
     */
    addSuccessfulMergesToMergeResult (resourcesIncomingArray, currentMergeResults) {
        /**
         * @type {MergeResultEntry[]}
         */
        const mergeResults = [];
        for (const resource of resourcesIncomingArray) {
            // if this resourceType,id is not in the merge results then add it as an unchanged entry
            if (currentMergeResults.filter(
                i => i._uuid === resource._uuid).length === 0) {
                /**
                 * @type {MergeResultEntry}
                 */
                const mergeResultItem = new MergeResultEntry({
                        id: resource.id,
                        uuid: resource._uuid,
                        sourceAssigningAuthority: resource._sourceAssigningAuthority,
                        resourceType: resource.resourceType,
                        created: false,
                        updated: false
                    }
                );
                mergeResults.push(mergeResultItem);
            }
        }
        return mergeResults;
    }

    /**
     * does a FHIR Merge
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<MergeResultEntry[]> | Promise<MergeResultEntry>| Promise<Resource>}
     */
    async mergeAsync ({ requestInfo, parsedArgs, resourceType }) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(resourceType !== undefined);
        assertTypeEquals(parsedArgs, ParsedArgs);
        const currentOperationName = 'merge';
        // Start the FHIR request timer, saving a reference to the returned method
        const timer = fhirRequestTimer.startTimer();
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            scope,
            /** @type {string | null} */
            originalUrl: url,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /** @type {string} */
            requestId,
            /** @type {string} */
            userRequestId,
            /** @type {Object} */
            headers,
            /** @type {string|null} */
            path,
            /** @type {Object | Object[] | null} */
            body,
            /** @type {string[]} */
            // eslint-disable-next-line no-unused-vars
            patientIdsFromJwtToken,
            /** @type {boolean} */
            // eslint-disable-next-line no-unused-vars
            isUser,
            /** @type {string} */
            // eslint-disable-next-line no-unused-vars
            personIdFromJwtToken
        } = requestInfo;

        await this.scopesValidator.verifyHasValidScopesAsync(
            {
                requestInfo,
                parsedArgs,
                resourceType,
                startTime,
                action: currentOperationName,
                accessRequested: 'write'
            }
        );

        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');

        // noinspection JSCheckFunctionSignatures
        try {
            const { /** @type {string} */ base_version } = parsedArgs;

            // read the incoming resource from request body
            /**
             * @type {Object|Object[]|undefined}
             */
            const incomingObjects = parsedArgs.resource ? parsedArgs.resource : body;

            const {
                /** @type {MergeResultEntry[]} */ mergePreCheckErrors,
                /** @type {Resource[]} */ resourcesIncomingArray,
                /** @type {boolean} */ wasIncomingAList
            } = await this.mergeValidator.validateAsync({
                base_version,
                currentDate,
                currentOperationName,
                incomingObjects,
                path,
                requestId,
                resourceType,
                scope,
                user,
                requestInfo
            });

            // merge the resources
            await this.mergeManager.mergeResourceListAsync(
                {
                    resources_incoming: resourcesIncomingArray,
                    resourceType,
                    currentDate,
                    base_version,
                    requestInfo
                }
            );
            /**
             * mergeResults
             * @type {MergeResultEntry[]}
             */
            let mergeResults = await this.databaseBulkInserter.executeAsync(
                {
                    requestInfo,
                    currentDate,
                    base_version
                });

            // add in any pre-merge failures
            mergeResults = mergeResults.concat(mergePreCheckErrors);

            mergeResults = mergeResults.concat(
                this.addSuccessfulMergesToMergeResult(resourcesIncomingArray, mergeResults)
            );

            mergeResults.sort((res1, res2) =>
                res1.uuid ? res2.uuid ? res1.uuid.localeCompare(res2.uuid) : 1 : -1
            );

            await this.mergeManager.logAuditEntriesForMergeResults({
                requestInfo, requestId, base_version, parsedArgs, mergeResults
            });

            await this.fhirLoggingManager.logOperationSuccessAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    result: JSON.stringify(mergeResults, getCircularReplacer())
                });

            /**
             * @type {number}
             */
            const stopTime = Date.now();
            if (headers.prefer && headers.prefer === 'return=OperationOutcome') {
                // https://hl7.org/fhir/http.html#ops
                // Client is requesting the result as OperationOutcome
                // Create a bundle of OperationOutcomes
                // create an OperationOutcome out of results
                /**
                 * @type {OperationOutcome[]}
                 */
                const operationOutcomes = mergeResults.map(m => {
                        return m.issue ? new OperationOutcome({
                            id: m.id,
                            resourceType: m.resourceType,
                            issue: [
                                new OperationOutcomeIssue({
                                    severity: 'information',
                                    code: 'informational',
                                    details: new CodeableConcept(
                                        { text: 'OK' }
                                    )
                                })]
                        }) : new OperationOutcome({
                            id: m.id,
                            resourceType: m.resourceType,
                            issue: [
                                new OperationOutcomeIssue({
                                        severity: 'information',
                                        code: 'informational',
                                        details: new CodeableConcept({
                                            coding: [
                                                new Coding({
                                                    // https://hl7.org/fhir/http.html#update
                                                    // The server SHALL return either a 200 OK HTTP status code if the
                                                    // resource was updated, or a 201 Created status code if the
                                                    // resource was created
                                                    system: 'https://www.rfc-editor.org/rfc/rfc9110.html',
                                                    code: m.created ? '201' : m.updated ? '200' : '304',
                                                    display: m.created ? 'Created' : m.updated ? 'Updated' : 'Not Modified'
                                                })
                                            ]
                                        }),
                                        expression: [
                                            `${m.resourceType}/${m.id}`
                                        ]
                                    }
                                )
                            ]
                        });
                    }
                );
                /**
                 * @type {Resource[]}
                 */
                const resources = operationOutcomes;
                return this.bundleManager.createBundle(
                    {
                        type: 'batch-response',
                        requestId: userRequestId,
                        originalUrl: url,
                        host,
                        protocol,
                        resources,
                        base_version,
                        total_count: operationOutcomes.length,
                        originalQuery: new QueryItem(
                            {
                                query: null,
                                resourceType,
                                collectionName: null
                            }
                        ),
                        originalOptions: {},
                        stopTime,
                        startTime,
                        user,
                        explanations: [],
                        parsedArgs
                    }
                );
            } else {
                return wasIncomingAList ? mergeResults : mergeResults[0];
            }
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync(
                {
                    requestInfo,
                    args: parsedArgs.getRawArgs(),
                    resourceType,
                    startTime,
                    action: currentOperationName,
                    error: e
                });
            throw e;
        } finally {
            timer({ action: currentOperationName, resourceType });
        }
    }
}

module.exports = {
    MergeOperation
};
