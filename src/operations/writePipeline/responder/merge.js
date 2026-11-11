const { assertTypeEquals } = require('../../../utils/assertType');
const { BundleResourceValidator } = require('../../merge/validators/bundleResourceValidator');
const { ParametersResourceValidator } = require('../../merge/validators/parameterResourceValidator');
const { MergeManager } = require('../../merge/mergeManager');
const { ScopesManager } = require('../../security/scopesManager');
const { BundleManager } = require('../../common/bundleManager');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const { buildOperationOutcomeFromIssues } = require('../../../utils/operationOutcomeBuilder');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const BundleSerializer = require('../../../fhir/serializers/4_0_0/resources/bundle');
const { QueryItem } = require('../../graph/queryItem');
const { COLLECTION } = require('../../../constants');
const { isUuid } = require('../../../utils/uid.util');
const { isTrue } = require('../../../utils/isTrue');
const { recordMergeOutcomes, recordInboundBundleSize, OPERATION } = require('../../../utils/metrics');
const { WriteItem, WRITE_ITEM_STATUS } = require('../writeItem');
const { WriteContext } = require('../writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteResponder } = require('./writeResponder');

/**
 * The statuses of items that finished without failing: unchanged and queued. `results` reports
 * these items from the flush results, or with a placeholder.
 */
const PLACEHOLDER_STATUSES = Object.freeze([WRITE_ITEM_STATUS.UNCHANGED, WRITE_ITEM_STATUS.QUEUED]);

/**
 * Compares two items by their position in the batch, for `sort`.
 */
const byIndex = (a, b) => a.index - b.index;
/**
 * Builds the `resourceType|uuid` key that matches flush results to items.
 */
const keyOf = ({ resourceType, uuid }) => `${resourceType}|${uuid}`;
/**
 * Returns a result entry's key, from its `resourceType` and `_uuid`.
 */
const resultKey = (result) => keyOf({ resourceType: result?.resourceType, uuid: result?._uuid });
/**
 * Returns an item's key, from its body's `resourceType` and `_uuid`.
 */
const itemKey = (item) => keyOf({ resourceType: item.incoming.resourceType, uuid: item.incoming._uuid });

/**
 * Holds everything that depends on `$merge`'s request and response format. It reads the body (one
 * resource, a list, a Bundle or Parameters) into items, builds the per-resource result entries in
 * request order, after the request-level errors, builds the response and records the `$merge`
 * metrics. The pipeline audits the result entries.
 */
class MergeResponder extends WriteResponder {
    /**
     * @param {BundleResourceValidator} bundleResourceValidator
     * @param {ParametersResourceValidator} parametersResourceValidator
     * @param {MergeManager} mergeManager
     * @param {ScopesManager} scopesManager
     * @param {BundleManager} bundleManager
     */
    constructor ({ bundleResourceValidator, parametersResourceValidator, mergeManager, scopesManager, bundleManager }) {
        super();
        /**
         * @type {BundleResourceValidator}
         */
        this.bundleResourceValidator = bundleResourceValidator;
        assertTypeEquals(bundleResourceValidator, BundleResourceValidator);
        /**
         * @type {ParametersResourceValidator}
         */
        this.parametersResourceValidator = parametersResourceValidator;
        assertTypeEquals(parametersResourceValidator, ParametersResourceValidator);
        /**
         * @type {MergeManager}
         */
        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
        /**
         * @type {BundleManager}
         */
        this.bundleManager = bundleManager;
        assertTypeEquals(bundleManager, BundleManager);
    }

    /**
     * Reads the body into a `WriteContext` and one `WriteItem` per resource, after unwrapping a
     * Bundle or Parameters and combining duplicate entries. Smart merge is on unless the request
     * turns it off. Each item missing what identifies it fails at the `STRUCTURE` stage. Returns
     * the context, the items, the request-level errors and whether the body was a list.
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{context: WriteContext, items: WriteItem[], requestErrors: MergeResultEntry[], wasIncomingAList: boolean}>}
     */
    async readAsync ({ requestInfo, parsedArgs, resourceType }) {
        const {
            /** @type {string} */ base_version,
            /** @type {boolean|null|undefined} */ smartMerge
        } = parsedArgs;
        const context = new WriteContext({
            requestInfo,
            base_version,
            parsedArgs,
            smartMerge: isTrue(smartMerge ?? true),
            operationName: 'merge'
        });
        /**
         * @type {Object|Object[]|undefined}
         */
        const incomingObjects = parsedArgs.resource ? parsedArgs.resource : requestInfo.body;
        /**
         * @type {MergeResultEntry[]}
         */
        const requestErrors = [];
        let wasIncomingAList = false;
        let incomingResources = incomingObjects;
        for (const validator of [this.bundleResourceValidator, this.parametersResourceValidator]) {
            const { validatedObjects, preCheckErrors, wasAList } = await validator.validate({
                base_version,
                incomingResources,
                resourceType,
                requestInfo,
                effectiveSmartMerge: context.smartMerge
            });
            incomingResources = validatedObjects;
            if (wasAList) {
                wasIncomingAList = true;
            }
            requestErrors.push(...preCheckErrors);
        }

        const dedupedResources = this.mergeManager.mergeDuplicateResourceEntries(incomingResources);
        if (Array.isArray(dedupedResources)) {
            wasIncomingAList = true;
        }
        const resources = Array.isArray(dedupedResources) ? dedupedResources : [dedupedResources];
        const items = resources.map((resource, index) => {
            if (resource.id) {
                resource.id = String(resource.id);
            }
            return new WriteItem({ index, incoming: resource });
        });

        for (const item of items) {
            const structuralError = this.findStructuralError(item.incoming);
            if (structuralError) {
                item.fail({
                    failure: new WriteFailure({
                        stage: WRITE_FAILURE_STAGE.STRUCTURE,
                        subject: {
                            id: structuralError.id,
                            uuid: structuralError._uuid,
                            sourceAssigningAuthority: structuralError._sourceAssigningAuthority,
                            resourceType: structuralError.resourceType
                        },
                        operationOutcome: structuralError.operationOutcome
                    })
                });
            }
        }

        return { context, items, requestErrors, wasIncomingAList };
    }

    /**
     * Returns a merge error entry if the resource has no id, no resourceType, an unsupported
     * resourceType, or neither a UUID id nor an owner or source assigning authority tag; otherwise
     * null.
     * @param {Object} resource
     * @returns {MergeResultEntry|null}
     */
    findStructuralError (resource) {
        const resourceType = resource.resourceType;
        const id = resource.id;

        if (!id) {
            return this.mergeManager.createMergeError(resource, resourceType, 'resource is missing id', resourceType);
        }

        if (!resource.resourceType) {
            return this.mergeManager.createMergeError(
                resource, resourceType, 'resource is missing resourceType', `${resourceType}/${id}`
            );
        }

        if (COLLECTION[resource.resourceType.toUpperCase()] !== resource.resourceType) {
            return this.mergeManager.createMergeError(
                resource, resourceType, 'resourceType is not supported', `${resourceType}/${id}`
            );
        }

        if (
            !isUuid(resource.id) &&
            !this.scopesManager.doesResourceHaveSourceAssigningAuthority(resource) &&
            !this.scopesManager.doesResourceHaveOwnerTags(resource)
        ) {
            return this.mergeManager.createMergeError(
                resource,
                resourceType,
                'Either id passed in resource should be uuid or meta.security tag with system: https://www.icanbwell.com/owner or https://www.icanbwell.com/sourceAssigningAuthority should be present',
                `${resourceType}/${id}`
            );
        }

        return null;
    }

    /**
     * Turns a failure into its `$merge` result entry. A check failure keeps its OperationOutcome
     * and first issue; an error failure goes through `MergeResultEntry.createFromError`.
     * @param {WriteFailure} failure
     * @returns {MergeResultEntry}
     */
    toResult (failure) {
        const { id, uuid, sourceAssigningAuthority, resourceType } = failure.subject;
        if (failure.operationOutcome !== null) {
            return new MergeResultEntry({
                id,
                uuid,
                sourceAssigningAuthority,
                resourceType,
                created: false,
                updated: false,
                issue: failure.operationOutcome.issue?.[0] || null,
                operationOutcome: failure.operationOutcome
            });
        }
        return MergeResultEntry.createFromError({
            error: failure.error,
            resource: { id, _uuid: uuid, _sourceAssigningAuthority: sourceAssigningAuthority, resourceType }
        });
    }

    /**
     * Returns the request-level errors, then one entry per failed item in request order. The
     * pipeline calls it before the flush, so `recordMetrics` still gets the failures if the flush
     * throws.
     * @param {WriteItem[]} items
     * @param {Object[]} requestErrors
     * @returns {MergeResultEntry[]}
     */
    failureResults ({ items, requestErrors }) {
        return [
            ...requestErrors,
            ...[...items]
                .sort(byIndex)
                .filter((item) => item.status === WRITE_ITEM_STATUS.FAILED)
                .map((item) => this.toResult(item.failure))
        ];
    }

    /**
     * Returns the final result entries: the request-level errors, then the items' entries in
     * request order, then any flush results no item matched. A failed item gets its failure entry.
     * When the flush returned results for an unchanged or queued item's resource type and `_uuid`,
     * the first such item gets all of them and later items with that key get none. When it returned
     * none, each such item gets a placeholder, unless a request error or a failed item has the same
     * key.
     * @param {WriteItem[]} items
     * @param {Object[]} requestErrors
     * @param {MergeResultEntry[]} executedResults
     * @returns {MergeResultEntry[]}
     */
    results ({ items, requestErrors, executedResults }) {
        const orderedItems = [...items].sort(byIndex);
        /**
         * @type {Map<WriteItem, MergeResultEntry>}
         */
        const failureResultByItem = new Map(
            orderedItems
                .filter((item) => item.status === WRITE_ITEM_STATUS.FAILED)
                .map((item) => [item, this.toResult(item.failure)])
        );
        /**
         * @type {Map<string, MergeResultEntry[]>}
         */
        const executedResultsByKey = new Map();
        for (const executedResult of executedResults) {
            const key = resultKey(executedResult);
            executedResultsByKey.set(key, [...(executedResultsByKey.get(key) ?? []), executedResult]);
        }
        const keysWithFailure = new Set([...requestErrors, ...failureResultByItem.values()].map(resultKey));
        /**
         * @type {Set<string>}
         */
        const reportedKeys = new Set();
        const entries = [...requestErrors];
        for (const item of orderedItems) {
            if (failureResultByItem.has(item)) {
                entries.push(failureResultByItem.get(item));
                continue;
            }
            if (!PLACEHOLDER_STATUSES.includes(item.status)) {
                continue;
            }
            const key = itemKey(item);
            if (executedResultsByKey.has(key)) {
                if (!reportedKeys.has(key)) {
                    reportedKeys.add(key);
                    entries.push(...executedResultsByKey.get(key));
                }
            } else if (!keysWithFailure.has(key)) {
                entries.push(this.placeholderFor(item));
            }
        }
        return [
            ...entries,
            ...executedResults.filter((executedResult) => !reportedKeys.has(resultKey(executedResult)))
        ];
    }

    /**
     * Returns a not-created, not-updated entry for an item that has no flush result.
     * @param {WriteItem} item
     * @returns {MergeResultEntry}
     */
    placeholderFor (item) {
        return new MergeResultEntry({
            id: item.incoming.id,
            uuid: item.incoming._uuid,
            sourceAssigningAuthority: item.incoming._sourceAssigningAuthority,
            resourceType: item.incoming.resourceType,
            created: false,
            updated: false
        });
    }

    /**
     * Returns the response: with `Prefer: return=OperationOutcome`, a batch-response Bundle with
     * one OperationOutcome per result; otherwise all results when the body was a list, or the first
     * one.
     * @param {WriteContext} context
     * @param {MergeResultEntry[]} results
     * @param {boolean} wasIncomingAList
     * @param {string} resourceType
     * @param {number} startTime
     * @param {number} stopTime
     * @returns {MergeResultEntry[] | MergeResultEntry | Resource}
     */
    toResponse ({ context, results, wasIncomingAList, resourceType, startTime, stopTime }) {
        const { requestInfo, base_version, parsedArgs } = context;
        const {
            /** @type {string | null} */
            user,
            /** @type {string | null} */
            originalUrl: url,
            /** @type {string | null} */
            protocol,
            /** @type {string | null} */
            host,
            /** @type {string} */
            userRequestId,
            /** @type {Object} */
            headers
        } = requestInfo;
        if (headers && headers.prefer && headers.prefer === 'return=OperationOutcome') {
            /**
             * @type {OperationOutcome[]}
             */
            const operationOutcomes = results.map(m => {
                    if (m.issue) {
                        return buildOperationOutcomeFromIssues([m.issue], m.id);
                    }
                    return buildOperationOutcomeFromIssues([
                        {
                            severity: 'information',
                            code: 'informational',
                            details: {
                                coding: [
                                    {
                                        system: 'https://www.rfc-editor.org/rfc/rfc9110.html',
                                        code: m.created ? '201' : m.updated ? '200' : '304',
                                        display: m.created ? 'Created' : m.updated ? 'Updated' : 'Not Modified'
                                    }
                                ]
                            },
                            expression: [
                                `${m.resourceType}/${m.id}`
                            ]
                        }
                    ], m.id);
                }
            );
            /**
             * @type {Resource[]}
             */
            const resources = operationOutcomes;
            const bundle = this.bundleManager.createRawBundle(
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
            return FhirResourceSerializer.serialize(bundle, BundleSerializer);
        } else {
            return wasIncomingAList ? results : results[0];
        }
    }

    /**
     * Records the merge outcomes of the results and the inbound size: a Bundle's entry count, a
     * list's length, 1 for any other body (including Parameters), or 0 with no body.
     * @param {MergeResultEntry[]} results
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {void}
     */
    recordMetrics ({ results, requestInfo, parsedArgs }) {
        /**
         * @type {Object|Object[]|undefined}
         */
        const incomingObjects = parsedArgs.resource ? parsedArgs.resource : requestInfo.body;
        const inboundCount = incomingObjects?.resourceType === 'Bundle'
            ? (incomingObjects.entry?.length ?? 0)
            : Array.isArray(incomingObjects)
                ? incomingObjects.length
                : (incomingObjects ? 1 : 0);
        recordMergeOutcomes(results);
        recordInboundBundleSize(OPERATION.MERGE, inboundCount);
    }
}

module.exports = {
    MergeResponder
};
