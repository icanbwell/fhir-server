'use strict';

/**
 * Category B (fail-by-design) tests for EverythingHelper.
 *
 * Every test here asserts the CORRECT behaviour that the current implementation does NOT
 * exhibit, so each one FAILS against `main`. They are the executable bug reports for the
 * findings recorded and must not be "fixed" by weakening the assertion - they turn green
 * only when the source is fixed.
 *
 * Findings proved here:
 *   customQuery parent-link clauses are ORed with (instead of ANDed to) the
 *   access-tag filter whenever there is more than one parent identifier.
 *
 *   the "no match found" diagnostic in processCursorAsync always prints
 *   "undefined/undefined" instead of naming the dropped child resource.
 *
 *   related-resource queries for a patient-scoped caller are built with
 *   applyPatientFilter=false for every clinical resource type, so expanded
 *   resources are not independently re-checked against the caller's scope.
 */

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/metrics', () => ({ recordOutboundEverything: jest.fn() }));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

function createCursor (docs = []) {
    let index = 0;
    const cursor = {
        maxTimeMS: () => cursor,
        hint: () => cursor,
        limit: () => cursor,
        getCollection: () => 'test_collection',
        explainAsync: async () => [],
        hasNext: async () => index < docs.length,
        next: async () => docs[index++]
    };
    return cursor;
}

function createParsedArgs (overrides = {}) {
    const parsedArgs = {
        _includeHidden: false,
        _since: undefined,
        headers: { prefer: undefined },
        get: jest.fn().mockReturnValue(undefined),
        getOriginal: jest.fn().mockReturnValue(undefined),
        getRawArgs: jest.fn().mockReturnValue({}),
        remove: jest.fn(),
        ...overrides
    };
    parsedArgs.clone = jest.fn().mockImplementation(() => ({ ...parsedArgs }));
    return parsedArgs;
}

describe('EverythingHelper - confirmed defects (Category B, fail until fixed)', () => {
    let everythingHelper;
    let mockSearchManager;
    let capturedQueries;
    let logging;

    beforeEach(() => {
        jest.clearAllMocks();
        capturedQueries = [];

        mockSearchManager = { constructQueryAsync: jest.fn().mockResolvedValue({ query: {} }) };
        logging = require('../../../../operations/common/logging');

        const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');
        everythingHelper = Object.create(EverythingHelper.prototype);
        everythingHelper.configManager = {
            useAccessIndex: true,
            everythingBatchSize: 10,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            everythingMaxParallelProcess: 5
        };
        everythingHelper.searchManager = mockSearchManager;
        everythingHelper.scopesValidator = { hasValidScopesAsync: jest.fn().mockResolvedValue(true) };
        everythingHelper.databaseQueryFactory = {
            createQuery: jest.fn().mockImplementation(({ resourceType }) => ({
                findAsync: async ({ query }) => {
                    capturedQueries.push({ resourceType, query });
                    return createCursor([]);
                }
            }))
        };
        everythingHelper.enrichmentManager = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => Promise.resolve(entries))
        };
        everythingHelper.r4ArgsParser = {
            parseArgs: jest.fn().mockImplementation(({ resourceType, args }) => ({
                resourceType, args, headers: {}, get: jest.fn()
            }))
        };
        everythingHelper.databaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        everythingHelper.base64DataManager = {
            transformAsync: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        everythingHelper.searchParametersManager = {
            getFieldNameForSearchParameter: jest.fn().mockReturnValue('subject')
        };
        everythingHelper.relatedResourceNeedingPatientScopeFilter = {
            Patient: ['Subscription', 'SubscriptionTopic', 'SubscriptionStatus', 'Person']
        };
        everythingHelper.uuidProjection = {
            _uuid: 1, _sourceId: 1, _sourceAssigningAuthority: 1, resourceType: 1
        };
    });

    function relatedArgs (overrides = {}) {
        const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');
        return {
            requestInfo: {
                user: 'u1',
                scope: 'user/*.read',
                isUser: false,
                personIdFromJwtToken: undefined,
                requestId: 'req-1',
                method: 'GET'
            },
            base_version: '4_0_0',
            parentResourceType: 'Patient',
            relatedResources: [],
            parsedArgs: createParsedArgs(),
            bundleEntryIdsProcessedTracker: new ResourceProccessedTracker(),
            parentResourceIdentifiers: [],
            parentResourcesProcessedTracker: new ResourceProccessedTracker(),
            proxyPatientIds: [],
            everythingRelatedResourceManager: { allowedToBeSent: () => true },
            nonClinicalReferencesExtractor: null,
            resourceToExcludeIdsMap: {},
            streamedResources: [],
            ...overrides
        };
    }

    const BIO_CUSTOM_QUERY = {
        query: '{"collection.source._uuid":"{resourceType}/{_uuid}"}',
        requiredValues: ['resourceType', '_uuid'],
        fieldForParentLookup: 'collection.source'
    };

    test(
        'with >1 parent identifier the access-tag filter must stay ' +
        'mandatory, not become an alternative of the parent-link clause',
        async () => {
            // Shape produced by SecurityTagManager.getQueryWithSecurityTags when useAccessIndex
            // is on and the caller holds two access codes: R4SearchQueryCreator wraps it as
            // {$and:[{$or:[...]}]} and MongoQuerySimplifier collapses that to a bare top-level $or.
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: { $or: [{ '_access.clientA': 1 }, { '_access.clientB': 1 }] }
            });

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'BiologicallyDerivedProduct', customQuery: BIO_CUSTOM_QUERY }],
                // a proxy-patient $everything routinely expands to more than one Patient
                parentResourceIdentifiers: [
                    { resourceType: 'Patient', _uuid: 'p-1' },
                    { resourceType: 'Patient', _uuid: 'p-2' }
                ]
            }));

            expect(capturedQueries).toHaveLength(1);
            const query = capturedQueries[0].query;

            // the parent-link restriction must still be applied somewhere
            expect(JSON.stringify(query)).toContain('collection.source._uuid');

            // ...but it must NOT sit in the same $or as the access-tag clauses. If it does,
            // a document carrying neither clientA nor clientB is returned purely because it
            // links to one of the patients - the access-tag check is bypassed.
            const alternatives = query.$or || [];
            const parentLinkIsMerelyOptional = alternatives.some(
                (alternative) => JSON.stringify(alternative).includes('collection.source')
            );
            expect(parentLinkIsMerelyOptional).toBe(false);

            // and the access-tag requirement must survive
            expect(JSON.stringify(query)).toContain('_access.clientA');
        }
    );

    test(
        'processCursorAsync must name the child resource it dropped, not "undefined/undefined"',
        async () => {
            const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');
            const parentTracker = new ResourceProccessedTracker();
            parentTracker.add({
                resourceType: 'Patient', _uuid: 'p-1', _sourceId: 'p1', _sourceAssigningAuthority: 'a'
            });

            await everythingHelper.processCursorAsync({
                cursor: createCursor([
                    {
                        resourceType: 'Condition',
                        _uuid: 'c-foreign',
                        _sourceId: 'cf',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/some-other-patient' }
                    }
                ]),
                requestInfo: {},
                responseStreamer: undefined,
                parentParsedArgs: createParsedArgs(),
                bundleEntryIdsProcessedTracker: new ResourceProccessedTracker(),
                resourceIdentifiers: null,
                nonClinicalReferencesExtractor: null,
                parentResourcesProcessedTracker: parentTracker,
                parentLookupField: 'subject',
                proxyPatientIds: [],
                parentResourceType: 'Patient',
                everythingRelatedResourceManager: { allowedToBeSent: () => true },
                useUuidProjection: false,
                streamedResources: []
            });

            expect(logging.logError).toHaveBeenCalledTimes(1);
            const message = logging.logError.mock.calls[0][0];
            // The dropped resource is the only thing an operator can act on; the message has to
            // identify it. Today it interpolates current_entity.resourceType/_uuid, which are
            // never set on the {id, resource} wrapper object.
            expect(message).toContain('Condition/c-foreign');
            expect(message).not.toContain('undefined/undefined');
        }
    );

    test(
        'clinical related-resource queries for a patient-scoped caller must ' +
        're-apply the patient filter instead of trusting the entry-point check',
        async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });
            const args = relatedArgs({
                relatedResources: [{ type: 'Observation', params: 'patient={ref}' }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }]
            });
            args.requestInfo.isUser = true;
            args.requestInfo.scope = 'patient/*.read';
            args.requestInfo.personIdFromJwtToken = 'my-person';

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(args);

            const observationCall = mockSearchManager.constructQueryAsync.mock.calls
                .find((c) => c[0].resourceType === 'Observation');
            expect(observationCall).toBeTruthy();
            // $graph does this (getForwardReferencesAsync / getReverseReferencesAsync both leave
            // applyPatientFilter at its default true). $everything opts out for every resource
            // type that is not Subscription*/Person, so the expanded resources are authorized
            // only by graph reachability from the entry-point Patient.
            expect(observationCall[0].applyPatientFilter).toBe(true);
        }
    );
});
