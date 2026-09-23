'use strict';

/**
 * Category B (fail-by-design) tests for GraphHelper.
 *
 * These assert the CORRECT behaviour that the current implementation does NOT exhibit, so
 * they FAIL against `main`. They are the executable bug reports for the findings recorded.
 *
 * Finding proved here:
 *   getReverseReferencesAsync attributes a Subscription-family resource to a
 *   Patient purely because the resource carries a `source_patient_id` identifier
 *   /extension naming that Patient. EverythingHelper.processCursorAsync
 *   deliberately dropped that rule ("the accompanying source_patient_id may name a
 *   patient no longer linked to that Person" - everythingHelper.js:1894-1898) and
 *   validates only `client_person_id` against the Persons the request discovered.
 *   $graph still does the unsafe match, so a subscription belonging to a different
 *   person who once shared the same source Patient is attached to this patient's graph.
 */

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
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

describe('GraphHelper - confirmed defects (Category B, fail until fixed)', () => {
    let graphHelper;
    let ResourceEntityAndContained;
    let docsByResourceType;

    beforeEach(() => {
        jest.clearAllMocks();
        docsByResourceType = {};

        ({ ResourceEntityAndContained } =
            require('../../../../operations/graph/resourceEntityAndContained'));

        const { GraphHelper } = require('../../../../operations/graph/graphHelpers');
        graphHelper = Object.create(GraphHelper.prototype);
        graphHelper.configManager = {
            useAccessIndex: false,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            graphBatchSize: 10
        };
        graphHelper.searchManager = { constructQueryAsync: jest.fn().mockResolvedValue({ query: {} }) };
        graphHelper.scopesValidator = { hasValidScopesAsync: jest.fn().mockResolvedValue(true) };
        graphHelper.databaseQueryFactory = {
            createQuery: jest.fn().mockImplementation(({ resourceType }) => ({
                findAsync: async () => createCursor(docsByResourceType[resourceType] || [])
            }))
        };
        graphHelper.bundleManager = {
            createRawBundle: jest.fn(),
            removeDuplicateEntries: jest.fn().mockImplementation(({ entries }) => entries)
        };
        graphHelper.enrichmentManager = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => Promise.resolve(entries))
        };
        graphHelper.r4ArgsParser = {
            parseArgs: jest.fn().mockImplementation(({ resourceType, args }) => ({
                resourceType, args, headers: {}, get: jest.fn()
            }))
        };
        graphHelper.databaseAttachmentManager = {
            transformAttachments: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        graphHelper.base64DataManager = {
            transformAsync: jest.fn().mockImplementation((r) => Promise.resolve(r))
        };
        graphHelper.searchParametersManager = {
            getFieldNameForSearchParameter: jest.fn().mockReturnValue('identifier'),
            getPropertyObject: jest.fn().mockReturnValue(undefined)
        };
    });

    test(
        '$graph must not attach a Subscription-family resource to a Patient ' +
        'on the strength of a source_patient_id identifier alone',
        async () => {
            // A SubscriptionStatus that belongs to a DIFFERENT person but still carries the
            // source patient id of a patient that person used to be linked to. It carries no
            // client_person_id for the requesting person, so nothing ties it to this graph.
            docsByResourceType.SubscriptionStatus = [
                {
                    resourceType: 'SubscriptionStatus',
                    id: 'sub-of-other-person',
                    _uuid: 'sub-uuid-other',
                    identifier: [
                        {
                            system: 'https://icanbwell.com/codes/source_patient_id',
                            value: 'shared-source-patient-uuid'
                        },
                        {
                            system: 'https://icanbwell.com/codes/client_person_id',
                            value: 'a-different-person-uuid'
                        }
                    ]
                }
            ];

            const patientResource = {
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'shared-source-patient-uuid'
            };
            const parent = new ResourceEntityAndContained({
                entityId: patientResource.id,
                entityUuid: patientResource._uuid,
                entityResourceType: patientResource.resourceType,
                includeInOutput: true,
                resource: patientResource,
                containedEntries: []
            });

            await graphHelper.getReverseReferencesAsync({
                requestInfo: {
                    user: 'u1',
                    scope: 'user/*.read',
                    isUser: false,
                    requestId: 'req-1',
                    method: 'GET'
                },
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                relatedResourceType: 'SubscriptionStatus',
                parentEntities: [parent],
                filterProperty: null,
                filterValue: null,
                reverse_filter: 'identifier={ref}',
                parsedArgs: { _includeHidden: false, base_version: '4_0_0' },
                supportLegacyId: false
            });

            // Correct behaviour: subscription-family resources resolve by Person identity only
            // (client_person_id), exactly as EverythingHelper.processCursorAsync does. This
            // subscription names another person, so it must not appear in this patient's graph.
            expect(parent.containedEntries.map((c) => c.resource._uuid)).toEqual([]);
        }
    );
});
