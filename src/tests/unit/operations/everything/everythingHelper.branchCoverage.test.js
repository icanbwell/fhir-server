'use strict';

/**
 * Branch-coverage + security tests for EverythingHelper ($everything).
 *
 * Complements everythingHelper.test.js (which covers the small pure helpers) by driving the
 * three largest orchestration methods:
 *   retriveEverythingAsync, retriveveRelatedResourcesParallelyAsync, processCursorAsync
 * plus fetchResourceByArgsAsync / _logAuditForRequestAsync / getCacheKey.
 *
 * Every test in THIS file asserts behaviour the code already implements correctly (Category A)
 * and must pass. Tests that assert correct behaviour the code does NOT implement live in
 * everythingHelper.securityBugs.test.js.
 *
 * Security rules referenced:
 *   - resource visible only if caller is authorized for an access tag
 *   - patient-scoped tokens must not be authorized purely by link-graph reachability
 *   - every resource in an expanded result must independently satisfy the caller's scope
 *   - consent/Person eligibility must use forward traversal from the named Person only
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

const httpContext = require('express-http-context');

/**
 * Minimal stand-in for DatabaseCursor. Supports the whole fluent surface EverythingHelper uses.
 * @param {object[]} docs
 */
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
        resourceFilterList: undefined,
        get: jest.fn().mockReturnValue(undefined),
        getOriginal: jest.fn().mockReturnValue(undefined),
        getRawArgs: jest.fn().mockReturnValue({}),
        remove: jest.fn(),
        ...overrides
    };
    parsedArgs.clone = jest.fn().mockImplementation(() => ({ ...parsedArgs }));
    return parsedArgs;
}

describe('EverythingHelper - branch coverage & security (Category A)', () => {
    let everythingHelper;
    let mockConfigManager;
    let mockSearchManager;
    let mockScopesValidator;
    let mockPostRequestProcessor;
    let mockAuditLogger;
    let capturedQueries;
    let cursorsByResourceType;
    let logging;

    beforeEach(() => {
        jest.clearAllMocks();
        capturedQueries = [];
        cursorsByResourceType = {};

        mockConfigManager = {
            useAccessIndex: false,
            everythingBatchSize: 2,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            writeToCacheForEverythingOperation: false,
            readFromCacheForEverythingOperation: false,
            everythingCacheTtlSeconds: 300,
            everythingMaxParallelProcess: 5,
            mongoInQueryIdBatchSize: 100
        };
        mockSearchManager = {
            constructQueryAsync: jest.fn().mockResolvedValue({ query: {} })
        };
        mockScopesValidator = {
            hasValidScopesAsync: jest.fn().mockResolvedValue(true)
        };
        mockPostRequestProcessor = { add: jest.fn() };
        mockAuditLogger = { logAuditEntryAsync: jest.fn().mockResolvedValue(undefined) };

        logging = require('../../../../operations/common/logging');

        const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');
        everythingHelper = Object.create(EverythingHelper.prototype);
        everythingHelper.configManager = mockConfigManager;
        everythingHelper.searchManager = mockSearchManager;
        everythingHelper.scopesValidator = mockScopesValidator;
        everythingHelper.postRequestProcessor = mockPostRequestProcessor;
        everythingHelper.auditLogger = mockAuditLogger;
        everythingHelper.databaseQueryFactory = {
            createQuery: jest.fn().mockImplementation(({ resourceType }) => ({
                findAsync: async ({ query, options }) => {
                    capturedQueries.push({ resourceType, query, options });
                    return createCursor(cursorsByResourceType[resourceType] || []);
                }
            }))
        };
        everythingHelper.bundleManager = {
            createRawBundle: jest.fn().mockImplementation(({ resources }) => ({
                resourceType: 'Bundle',
                type: 'searchset',
                entry: resources.map((r) => ({ resource: r }))
            }))
        };
        everythingHelper.enrichmentManager = {
            enrichBundleEntriesAsync: jest.fn().mockImplementation(({ entries }) => Promise.resolve(entries))
        };
        everythingHelper.r4ArgsParser = {
            parseArgs: jest.fn().mockImplementation(({ resourceType, args }) => ({
                resourceType,
                args,
                headers: {},
                get: jest.fn(),
                getRawArgs: jest.fn().mockReturnValue(args)
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
        everythingHelper.everythingRelatedResourceMapper = { relatedResources: jest.fn().mockReturnValue([]) };
        everythingHelper.customTracer = { trace: jest.fn().mockImplementation(({ func }) => func()) };
        everythingHelper.patientDataViewControlManager = {
            getConsentAsync: jest.fn().mockResolvedValue({
                viewControlResourceToExcludeMap: {},
                viewControlConsentQueries: [],
                viewControlConsentQueryOptions: []
            })
        };
        everythingHelper.redisStreamManager = {
            hasCachedStream: jest.fn().mockResolvedValue(false),
            deleteStream: jest.fn().mockResolvedValue(undefined)
        };
        everythingHelper.redisManager = { getCacheAsync: jest.fn(), incrementGenerationAsync: jest.fn() };
        everythingHelper.supportedResources = ['Patient'];
        everythingHelper.relatedResourceNeedingPatientScopeFilter = {
            Patient: ['Subscription', 'SubscriptionTopic', 'SubscriptionStatus', 'Person']
        };
        everythingHelper.uuidProjection = {
            _uuid: 1,
            _sourceId: 1,
            _sourceAssigningAuthority: 1,
            resourceType: 1
        };
    });

    /** Shared args for retriveveRelatedResourcesParallelyAsync */
    function relatedArgs (overrides = {}) {
        const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');
        return {
            requestInfo: {
                user: 'u1',
                scope: 'user/*.read',
                isUser: false,
                userType: undefined,
                personIdFromJwtToken: undefined,
                requestId: 'req-1',
                actor: undefined,
                method: 'GET'
            },
            base_version: '4_0_0',
            parentResourceType: 'Patient',
            relatedResources: [],
            parsedArgs: createParsedArgs(),
            responseStreamer: undefined,
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

    describe('retriveveRelatedResourcesParallelyAsync - query construction', () => {
        test('single parent identifier ANDs the customQuery parent-link clause onto the access-tag query', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: { $or: [{ '_access.clientA': 1 }, { '_access.clientB': 1 }] }
            });

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'BiologicallyDerivedProduct', customQuery: BIO_CUSTOM_QUERY }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }]
            }));

            expect(capturedQueries).toHaveLength(1);
            const query = capturedQueries[0].query;
            // The access-tag alternatives stay as the only top-level $or; the parent link is a
            // mandatory $and clause, so a document must satisfy BOTH.
            expect(query.$and).toEqual([{ 'collection.source._uuid': 'Patient/p-1' }]);
            expect(query.$or).toEqual([{ '_access.clientA': 1 }, { '_access.clientB': 1 }]);
        });

        test('escapes customQuery substitution values so a crafted _uuid cannot inject query operators', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });
            const maliciousUuid = 'abc","$where":"sleep(1000)';

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'BiologicallyDerivedProduct', customQuery: BIO_CUSTOM_QUERY }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: maliciousUuid }]
            }));

            const query = capturedQueries[0].query;
            const injectedClause = query.$and ? query.$and[0] : query;
            expect(Object.keys(injectedClause)).toEqual(['collection.source._uuid']);
            expect(injectedClause['collection.source._uuid']).toBe(`Patient/${maliciousUuid}`);
            expect(JSON.stringify(query)).not.toContain('"$where"');
        });

        test('throws when a customQuery required value is missing from the parent identifier (fail-closed)', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            await expect(
                everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                    relatedResources: [{ type: 'BiologicallyDerivedProduct', customQuery: BIO_CUSTOM_QUERY }],
                    parentResourceIdentifiers: [{ resourceType: 'Patient' }]
                }))
            ).rejects.toThrow('_uuid is not present in parent resource identifier');

            expect(capturedQueries).toHaveLength(0);
        });

        test('matchPerson customQuery is skipped entirely when no Person was discovered', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            const result = await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{
                    type: 'SubscriptionStatus',
                    customQuery: {
                        query: '{"extension":{"$elemMatch":{"url":"client_person_id","valueString":"{_uuid}"}}}',
                        requiredValues: ['_uuid'],
                        fieldForParentLookup: 'extension',
                        matchPerson: true
                    }
                }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }],
                personResourceIdentifiers: []
            }));

            expect(capturedQueries).toHaveLength(0);
            expect(result.queryItems).toEqual([]);
        });

        test('matchPerson customQuery templates against the discovered Person uuids, not the Patient uuids', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{
                    type: 'SubscriptionStatus',
                    customQuery: {
                        query: '{"extension":{"$elemMatch":{"url":"client_person_id","valueString":"{_uuid}"}}}',
                        requiredValues: ['_uuid'],
                        fieldForParentLookup: 'extension',
                        matchPerson: true
                    }
                }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'patient-uuid' }],
                personResourceIdentifiers: [{ resourceType: 'Person', _uuid: 'person-uuid' }]
            }));

            const serialized = JSON.stringify(capturedQueries[0].query);
            expect(serialized).toContain('person-uuid');
            expect(serialized).not.toContain('patient-uuid');
        });

        test('Person related-resource query is restricted to the explicitly requested scopedPersonIds', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'Person', params: 'patient={ref}' }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }],
                scopedPersonIds: ['person-allowed']
            }));

            expect(JSON.stringify(capturedQueries[0].query)).toContain('person-allowed');
        });

        test('applies patient-scope filter for Subscription-family related resources of a patient-scoped caller', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });
            const args = relatedArgs({
                relatedResources: [{ type: 'Person', params: 'patient={ref}' }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }]
            });
            args.requestInfo.isUser = true;
            args.requestInfo.personIdFromJwtToken = 'me';

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(args);

            const call = mockSearchManager.constructQueryAsync.mock.calls
                .find((c) => c[0].resourceType === 'Person');
            expect(call[0].applyPatientFilter).toBe(true);
        });

        test('skips a related resource type the caller has no scope for', async () => {
            mockScopesValidator.hasValidScopesAsync.mockImplementation(
                async ({ resourceType }) => resourceType !== 'Condition'
            );
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            const result = await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [
                    { type: 'Condition', params: 'patient={ref}' },
                    { type: 'Observation', params: 'patient={ref}' }
                ],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }]
            }));

            expect(capturedQueries.map((q) => q.resourceType)).toEqual(['Observation']);
            expect(result.queryItems.map((q) => q.resourceType)).toEqual(['Observation']);
        });

        test('skips related resources that declare neither params nor customQuery', async () => {
            const result = await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'Condition' }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }]
            }));

            expect(capturedQueries).toHaveLength(0);
            expect(result.queryItems).toEqual([]);
        });

        test('loop boundary: returns no queries when there are zero parent identifiers and zero proxy patients', async () => {
            const result = await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'Condition', params: 'patient={ref}' }],
                parentResourceIdentifiers: []
            }));

            expect(result.entities).toEqual([]);
            expect(result.queryItems).toEqual([]);
            expect(mockSearchManager.constructQueryAsync).not.toHaveBeenCalled();
        });

        test('loop boundary: >1 related resources each produce their own QueryItem and reference every parent id', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            const result = await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [
                    { type: 'Condition', params: 'patient={ref}' },
                    { type: 'Observation', params: 'subject={ref}' },
                    { type: 'Encounter', params: 'patient={ref}' }
                ],
                parentResourceIdentifiers: [
                    { resourceType: 'Patient', _uuid: 'p-1' },
                    { resourceType: 'Patient', _uuid: 'p-2' }
                ]
            }));

            expect(result.queryItems.map((q) => q.resourceType))
                .toEqual(['Condition', 'Observation', 'Encounter']);
            const parsedQueryStrings = everythingHelper.r4ArgsParser.parseArgs.mock.calls
                .map((c) => JSON.stringify(c[0].args));
            expect(parsedQueryStrings.every((s) => s.includes('Patient/p-1') && s.includes('Patient/p-2')))
                .toBe(true);
        });

        test('view-control exclusions are pushed into the related resource query as id:not', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'Condition', params: 'patient={ref}' }],
                parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }],
                resourceToExcludeIdsMap: { Condition: ['cond-hidden-1', 'cond-hidden-2'] }
            }));

            const parseCall = everythingHelper.r4ArgsParser.parseArgs.mock.calls
                .find((c) => c[0].resourceType === 'Condition');
            expect(parseCall[0].args['id:not']).toBe('cond-hidden-1,cond-hidden-2');
        });

        test('includeProxyPatient customQuery adds a _sourceId clause for a non-uuid proxy patient id', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{
                    type: 'BiologicallyDerivedProduct',
                    customQuery: {
                        ...BIO_CUSTOM_QUERY,
                        includeProxyPatient: true,
                        proxyPatientQuery: '{"collection.source.{idType}":"{resourceType}/{id}"}',
                        proxyPatientRequiredValues: ['resourceType', 'id', 'idType']
                    }
                }],
                parentResourceIdentifiers: [],
                proxyPatientIds: ['person.abc']
            }));

            expect(JSON.stringify(capturedQueries[0].query))
                .toContain('"collection.source._sourceId":"Patient/person.abc"');
        });

        test('throws when a required proxy-patient template value is missing (fail-closed)', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });

            await expect(
                everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                    relatedResources: [{
                        type: 'BiologicallyDerivedProduct',
                        customQuery: {
                            ...BIO_CUSTOM_QUERY,
                            includeProxyPatient: true,
                            proxyPatientQuery: '{"collection.source.{idType}":"{resourceType}/{missingField}"}',
                            proxyPatientRequiredValues: ['missingField']
                        }
                    }],
                    parentResourceIdentifiers: [],
                    proxyPatientIds: ['person.abc']
                }))
            ).rejects.toThrow('missingField is not present in proxy patient resource identifier');
        });

        test('throws when the params search parameter cannot be resolved to a field name', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });
            everythingHelper.searchParametersManager.getFieldNameForSearchParameter
                .mockReturnValue(undefined);

            await expect(
                everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                    relatedResources: [{ type: 'Condition', params: 'bogusparam={ref}' }],
                    parentResourceIdentifiers: [{ resourceType: 'Patient', _uuid: 'p-1' }]
                }))
            ).rejects.toThrow('bogusparam is not a valid search parameter for resource Condition');
        });

        test('consented-PROA branch ANDs the parent-link clause into every existing $or alternative', async () => {
            httpContext.get.mockImplementation((key) => key === 'consentedProaDataAccessed');
            mockSearchManager.constructQueryAsync.mockResolvedValue({
                query: { $or: [{ $and: [{ '_access.clientA': 1 }] }, { $and: [{ '_access.clientB': 1 }] }] }
            });

            await everythingHelper.retriveveRelatedResourcesParallelyAsync(relatedArgs({
                relatedResources: [{ type: 'BiologicallyDerivedProduct', customQuery: BIO_CUSTOM_QUERY }],
                parentResourceIdentifiers: [
                    { resourceType: 'Patient', _uuid: 'p-1' },
                    { resourceType: 'Patient', _uuid: 'p-2' }
                ]
            }));

            const query = capturedQueries[0].query;
            // every alternative keeps its own access-tag requirement AND gains the parent link
            expect(query.$or).toHaveLength(2);
            for (const alternative of query.$or) {
                const text = JSON.stringify(alternative);
                expect(text).toContain('_access.client');
                expect(text).toContain('collection.source._uuid');
            }
        });
    });

    describe('processCursorAsync - parent matching and emission', () => {
        const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');

        function cursorArgs (docs, overrides = {}) {
            const parentTracker = new ResourceProccessedTracker();
            parentTracker.add({ resourceType: 'Patient', _uuid: 'p-1', _sourceId: 'p1', _sourceAssigningAuthority: 'a' });
            return {
                cursor: createCursor(docs),
                requestInfo: { userType: undefined, actor: undefined },
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
                streamedResources: [],
                ...overrides
            };
        }

        test('emits a child resource whose parent reference matches a tracked parent', async () => {
            const result = await everythingHelper.processCursorAsync(cursorArgs([
                {
                    resourceType: 'Condition',
                    _uuid: 'c-1',
                    _sourceId: 'c1',
                    _sourceAssigningAuthority: 'a',
                    subject: { _uuid: 'Patient/p-1' }
                }
            ]));

            expect(result.bundleEntries).toHaveLength(1);
            expect(result.bundleEntries[0].resource._uuid).toBe('c-1');
        });

        test('drops a child resource that references a patient outside the traversed parent set', async () => {
            const result = await everythingHelper.processCursorAsync(cursorArgs([
                {
                    resourceType: 'Condition',
                    _uuid: 'c-foreign',
                    _sourceId: 'cf',
                    _sourceAssigningAuthority: 'a',
                    subject: { _uuid: 'Patient/some-other-patient' }
                }
            ]));

            expect(result.bundleEntries).toHaveLength(0);
        });

        test('subscription fallback rejects a client_person_id that is not one of the discovered Persons', async () => {
            const result = await everythingHelper.processCursorAsync(cursorArgs(
                [
                    {
                        resourceType: 'SubscriptionStatus',
                        _uuid: 's-1',
                        _sourceId: 's1',
                        _sourceAssigningAuthority: 'a',
                        extension: [{
                            url: 'https://icanbwell.com/codes/client_person_id',
                            valueString: 'attacker-person'
                        }]
                    }
                ],
                {
                    parentLookupField: 'extension',
                    personResourceIdentifiers: [{ resourceType: 'Person', _uuid: 'my-person' }]
                }
            ));

            expect(result.bundleEntries).toHaveLength(0);
        });

        test('subscription fallback accepts a client_person_id belonging to a discovered Person', async () => {
            const result = await everythingHelper.processCursorAsync(cursorArgs(
                [
                    {
                        resourceType: 'SubscriptionStatus',
                        _uuid: 's-1',
                        _sourceId: 's1',
                        _sourceAssigningAuthority: 'a',
                        extension: [{
                            url: 'https://icanbwell.com/codes/client_person_id',
                            valueString: 'my-person'
                        }]
                    }
                ],
                {
                    parentLookupField: 'extension',
                    personResourceIdentifiers: [{ resourceType: 'Person', _uuid: 'my-person' }]
                }
            ));

            expect(result.bundleEntries).toHaveLength(1);
            expect(result.bundleEntries[0].resource._uuid).toBe('s-1');
        });

        test('loop boundary: with >1 documents the processed tracker de-duplicates repeats of the same resource', async () => {
            const doc = {
                resourceType: 'Condition',
                _uuid: 'c-1',
                _sourceId: 'c1',
                _sourceAssigningAuthority: 'a',
                subject: { _uuid: 'Patient/p-1' }
            };
            const result = await everythingHelper.processCursorAsync(cursorArgs([
                doc,
                { ...doc },
                {
                    resourceType: 'Condition',
                    _uuid: 'c-2',
                    _sourceId: 'c2',
                    _sourceAssigningAuthority: 'a',
                    subject: { _uuid: 'Patient/p-1' }
                }
            ]));

            expect(result.bundleEntries.map((e) => e.resource._uuid)).toEqual(['c-1', 'c-2']);
        });

        test('_since filter excludes resources last updated at or before the since instant', async () => {
            const since = new Date('2024-06-01T00:00:00Z');
            const result = await everythingHelper.processCursorAsync(cursorArgs(
                [
                    {
                        resourceType: 'Condition',
                        _uuid: 'old',
                        _sourceId: 'old',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/p-1' },
                        meta: { lastUpdated: new Date('2024-01-01T00:00:00Z') }
                    },
                    {
                        resourceType: 'Condition',
                        _uuid: 'new',
                        _sourceId: 'new',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/p-1' },
                        meta: { lastUpdated: new Date('2024-12-01T00:00:00Z') }
                    }
                ],
                { parentParsedArgs: createParsedArgs({ _since: since }) }
            ));

            expect(result.bundleEntries.map((e) => e.resource._uuid)).toEqual(['new']);
        });

        test('a resource type excluded by the _type filter is not emitted even when its parent matches', async () => {
            const result = await everythingHelper.processCursorAsync(cursorArgs(
                [
                    {
                        resourceType: 'Condition',
                        _uuid: 'c-1',
                        _sourceId: 'c1',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/p-1' }
                    }
                ],
                { everythingRelatedResourceManager: { allowedToBeSent: (t) => t !== 'Condition' } }
            ));

            expect(result.bundleEntries).toHaveLength(0);
        });

        test('collects Person resources into personResourceIdentifierMap keyed by uuid', async () => {
            const personMap = new Map();
            await everythingHelper.processCursorAsync(cursorArgs(
                [
                    {
                        resourceType: 'Person',
                        _uuid: 'person-1',
                        _sourceId: 'pr1',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/p-1' }
                    },
                    {
                        resourceType: 'Person',
                        _uuid: 'person-1',
                        _sourceId: 'pr1',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/p-1' }
                    }
                ],
                { personResourceIdentifierMap: personMap }
            ));

            expect(Array.from(personMap.keys())).toEqual(['person-1']);
            expect(personMap.get('person-1').resourceType).toBe('Person');
        });

        test('streaming mode writes to the cached streamer and records the resource for audit', async () => {
            const written = [];
            const streamedResources = [];
            const cachedStreamer = {
                writeBundleEntryToRedis: jest.fn().mockResolvedValue(undefined)
            };
            await everythingHelper.processCursorAsync(cursorArgs(
                [
                    {
                        resourceType: 'Condition',
                        _uuid: 'c-1',
                        _sourceId: 'c1',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/p-1' }
                    }
                ],
                {
                    responseStreamer: {
                        writeBundleEntryAsync: jest.fn().mockImplementation(async ({ bundleEntry }) => {
                            written.push(bundleEntry);
                        })
                    },
                    cachedStreamer,
                    streamedResources
                }
            ));

            expect(written).toHaveLength(1);
            expect(cachedStreamer.writeBundleEntryToRedis).toHaveBeenCalledTimes(1);
            expect(streamedResources).toEqual([{ _uuid: 'c-1', resourceType: 'Condition' }]);
        });

        test('uuid projection strips the parent lookup field and rewrites id to the uuid', async () => {
            const result = await everythingHelper.processCursorAsync(cursorArgs(
                [
                    {
                        resourceType: 'Condition',
                        id: 'legacy-id',
                        _uuid: 'c-1',
                        _sourceId: 'c1',
                        _sourceAssigningAuthority: 'a',
                        subject: { _uuid: 'Patient/p-1' }
                    }
                ],
                { useUuidProjection: true }
            ));

            expect(result.bundleEntries).toHaveLength(1);
            expect(result.bundleEntries[0].resource.subject).toBeUndefined();
            expect(result.bundleEntries[0].resource.id).toBe('c-1');
        });
    });

    describe('retriveEverythingAsync - top level orchestration', () => {
        function everythingArgs (ids, overrides = {}) {
            const parsedArgs = createParsedArgs({
                get: jest.fn().mockImplementation((k) =>
                    k === 'id' ? { queryParameterValue: { values: ids } } : undefined
                )
            });
            return {
                requestInfo: {
                    user: 'u1',
                    scope: 'patient/*.read',
                    isUser: true,
                    personIdFromJwtToken: 'my-person',
                    requestId: 'req-1',
                    userRequestId: 'ureq-1',
                    host: 'h',
                    protocol: 'https',
                    method: 'GET',
                    accept: 'application/fhir+json',
                    skipCachedData: () => true
                },
                base_version: '4_0_0',
                resourceType: 'Patient',
                responseStreamer: undefined,
                parsedArgs,
                includeNonClinicalResources: false,
                ...overrides
            };
        }

        test('rejects $everything for an unsupported resource type', async () => {
            await expect(
                everythingHelper.retriveEverythingAsync(everythingArgs(['x'], { resourceType: 'Observation' }))
            ).rejects.toThrow('$everything is not supported for resource: Observation');
        });

        test('a patient-scoped caller cannot expand another person\'s proxy-patient id', async () => {
            everythingHelper.retrieveEverythingMulipleIdsAsync = jest.fn().mockResolvedValue({
                entries: [], queryItems: [], options: [], explanations: []
            });

            await everythingHelper.retriveEverythingAsync(
                everythingArgs(['person.attacker-person'])
            );

            expect(everythingHelper.retrieveEverythingMulipleIdsAsync).toHaveBeenCalledTimes(1);
            expect(everythingHelper.retrieveEverythingMulipleIdsAsync.mock.calls[0][0].proxyPatientIds)
                .toEqual([]);
        });

        test('a patient-scoped caller keeps their own proxy-patient id', async () => {
            everythingHelper.retrieveEverythingMulipleIdsAsync = jest.fn().mockResolvedValue({
                entries: [], queryItems: [], options: [], explanations: []
            });

            await everythingHelper.retriveEverythingAsync(everythingArgs(['person.my-person']));

            expect(everythingHelper.retrieveEverythingMulipleIdsAsync.mock.calls[0][0].proxyPatientIds)
                .toEqual(['person.my-person']);
        });

        test('loop boundary: ids beyond the batch size are processed in chunks with increasing chunk index', async () => {
            mockConfigManager.everythingBatchSize = 2;
            everythingHelper.retrieveEverythingMulipleIdsAsync = jest.fn().mockResolvedValue({
                entries: [], queryItems: [], options: [], explanations: []
            });

            await everythingHelper.retriveEverythingAsync(
                everythingArgs(['a', 'b', 'c', 'd', 'e'])
            );

            const calls = everythingHelper.retrieveEverythingMulipleIdsAsync.mock.calls;
            expect(calls).toHaveLength(3);
            expect(calls.map((c) => c[0].everythingChunkIndex)).toEqual([0, 1, 2]);
            expect(calls.map((c) => c[0].parsedArgs.id)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
        });

        test('rejects with a BadRequestError when no id was supplied', async () => {
            const parsedArgs = createParsedArgs({ get: jest.fn().mockReturnValue(undefined) });
            await expect(
                everythingHelper.retriveEverythingAsync(
                    everythingArgs(['x'], { parsedArgs })
                )
            ).rejects.toThrow('No id was passed either in path param or query param');
        });
    });

    describe('_logAuditForRequestAsync', () => {
        test('enqueues one audit task per distinct resource type with that type\'s uuids', () => {
            everythingHelper._logAuditForRequestAsync({
                resourcesToAudit: [
                    { _uuid: 'c-1', resourceType: 'Condition' },
                    { _uuid: 'o-1', resourceType: 'Observation' },
                    { _uuid: 'c-2', resourceType: 'Condition' }
                ],
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'Patient',
                parsedArgs: createParsedArgs()
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalledTimes(2);
        });

        test('never writes an audit entry for the AuditEvent resource type itself', () => {
            everythingHelper._logAuditForRequestAsync({
                resourcesToAudit: [{ _uuid: 'a-1', resourceType: 'AuditEvent' }],
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                parsedArgs: createParsedArgs()
            });

            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('does nothing when nothing was read and no failure outcome was supplied', () => {
            everythingHelper._logAuditForRequestAsync({
                resourcesToAudit: [],
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'Patient',
                parsedArgs: createParsedArgs()
            });

            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
        });

        test('still records a failure audit for the requested type when nothing was streamed', () => {
            everythingHelper._logAuditForRequestAsync({
                resourcesToAudit: [],
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'Patient',
                parsedArgs: createParsedArgs(),
                outcome: '8',
                outcomeDesc: 'boom'
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalledTimes(1);
            expect(mockPostRequestProcessor.add.mock.calls[0][0].requestId).toBe('req-1');
        });
    });

    describe('getCacheKey - cache key safety', () => {
        test('refuses to cache for a client (non patient-scoped) token', async () => {
            const key = await everythingHelper.getCacheKey(
                createParsedArgs(), { personIdFromJwtToken: undefined, userType: undefined },
                'Patient', '4_0_0', false
            );
            expect(key).toBeUndefined();
        });

        test('refuses to cache when more than one id was requested', async () => {
            const parsedArgs = createParsedArgs({
                getOriginal: jest.fn().mockImplementation((k) =>
                    k === 'id' ? { queryParameterValue: { value: 'a,b' } } : undefined
                )
            });
            const key = await everythingHelper.getCacheKey(
                parsedArgs,
                { personIdFromJwtToken: 'me', userType: undefined, accept: 'application/fhir+json' },
                'Patient', '4_0_0', false
            );
            expect(key).toBeUndefined();
        });

        test('CACHE-2: refuses to cache a proxy-patient request for a person other than the caller', async () => {
            const parsedArgs = createParsedArgs({
                getOriginal: jest.fn().mockImplementation((k) =>
                    k === 'id'
                        ? { queryParameterValue: { value: 'person.11111111-1111-1111-1111-111111111111' } }
                        : undefined
                )
            });
            const key = await everythingHelper.getCacheKey(
                parsedArgs,
                {
                    personIdFromJwtToken: '22222222-2222-2222-2222-222222222222',
                    userType: undefined,
                    accept: 'application/fhir+json',
                    scope: 'patient/*.read'
                },
                'Patient', '4_0_0', false
            );
            expect(key).toBeUndefined();
        });
    });

    describe('fetchResourceByArgsAsync', () => {
        test('returns no entries and issues no query when the caller lacks scope (fail-closed)', async () => {
            mockScopesValidator.hasValidScopesAsync.mockResolvedValue(false);

            const result = await everythingHelper.fetchResourceByArgsAsync({
                base_version: '4_0_0',
                requestInfo: { method: 'GET', isUser: false, requestId: 'r' },
                resourceType: 'Patient',
                parsedArgs: createParsedArgs(),
                resourceIdentifiers: [],
                everythingRelatedResourceManager: { allowedToBeSent: () => true },
                bundleEntryIdsProcessedTracker:
                    new (require('../../../../fhir/resourceProcessedTracker').ResourceProccessedTracker)()
            });

            expect(result.entries).toEqual([]);
            expect(capturedQueries).toHaveLength(0);
            expect(mockSearchManager.constructQueryAsync).not.toHaveBeenCalled();
        });

        test('gates PROA consented-data expansion on isPersonEverything, not on the resourceType', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: {} });
            const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');

            await everythingHelper.fetchResourceByArgsAsync({
                base_version: '4_0_0',
                requestInfo: { method: 'GET', isUser: true, requestId: 'r', personIdFromJwtToken: 'me' },
                resourceType: 'Patient',
                parsedArgs: createParsedArgs(),
                resourceIdentifiers: [],
                everythingRelatedResourceManager: { allowedToBeSent: () => true },
                bundleEntryIdsProcessedTracker: new ResourceProccessedTracker(),
                isPersonEverything: false,
                scopedPersonIds: ['some-person']
            });

            const call = mockSearchManager.constructQueryAsync.mock.calls[0][0];
            expect(call.allowConsentedProaDataAccess).toBe(false);
            expect(call.useProxyPatientToPersonCache).toBe(true);
        });

        test('logs nothing and still returns a well-formed result for an empty cursor', async () => {
            mockSearchManager.constructQueryAsync.mockResolvedValue({ query: { _uuid: 'p-1' } });
            const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');

            const result = await everythingHelper.fetchResourceByArgsAsync({
                base_version: '4_0_0',
                requestInfo: { method: 'GET', isUser: false, requestId: 'r' },
                resourceType: 'Patient',
                parsedArgs: createParsedArgs(),
                resourceIdentifiers: [],
                everythingRelatedResourceManager: { allowedToBeSent: () => true },
                bundleEntryIdsProcessedTracker: new ResourceProccessedTracker()
            });

            expect(result.entries).toEqual([]);
            expect(result.queryItems).toHaveLength(1);
            expect(result.queryItems[0].resourceType).toBe('Patient');
            expect(result.options[0].projection._id).toBe(0);
            expect(logging.logError).not.toHaveBeenCalled();
        });
    });
});
