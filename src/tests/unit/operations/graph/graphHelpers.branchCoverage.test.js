'use strict';

/**
 * Branch-coverage + security tests for GraphHelper ($graph / $graph DELETE).
 *
 * Complements graphHelpers.test.js by driving the traversal and emission paths:
 *   getForwardReferencesAsync, getReverseReferencesAsync, processLinkTargetAsync,
 *   processMultipleIdsAsync, processGraphAsync, deleteGraphAsync,
 *   getReverseLinkSearchParameterName, getRecursiveContainedEntities.
 *
 * All tests in THIS file assert behaviour the code already implements correctly (Category A)
 * and must pass. Fail-by-design tests live in graphHelpers.securityBugs.test.js.
 *
 * Security rules referenced: access-tag scoping, write authorization, traversal boundary
 * and per-resource scope re-check.
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

function createParsedArgs (overrides = {}) {
    const parsedArgs = {
        _includeHidden: false,
        base_version: '4_0_0',
        get: jest.fn().mockReturnValue(undefined),
        getRawArgs: jest.fn().mockReturnValue({}),
        remove: jest.fn(),
        headers: {},
        ...overrides
    };
    parsedArgs.clone = jest.fn().mockImplementation(() => ({ ...parsedArgs }));
    return parsedArgs;
}

describe('GraphHelper - branch coverage & security (Category A)', () => {
    let graphHelper;
    let ResourceEntityAndContained;
    let mockConfigManager;
    let mockSearchManager;
    let mockScopesValidator;
    let mockRemoveHelper;
    let mockPostRequestProcessor;
    let capturedQueries;
    let docsByResourceType;
    let logging;

    const requestInfo = {
        user: 'u1',
        scope: 'user/*.read',
        isUser: false,
        userType: undefined,
        personIdFromJwtToken: undefined,
        requestId: 'req-1',
        userRequestId: 'ureq-1',
        host: 'h',
        protocol: 'https',
        originalUrl: '/4_0_0/Patient/$graph',
        method: 'GET'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        capturedQueries = [];
        docsByResourceType = {};

        logging = require('../../../../operations/common/logging');
        ({ ResourceEntityAndContained } =
            require('../../../../operations/graph/resourceEntityAndContained'));

        mockConfigManager = {
            useAccessIndex: false,
            mongoTimeout: 30000,
            supportLegacyIds: false,
            graphBatchSize: 2
        };
        mockSearchManager = { constructQueryAsync: jest.fn().mockResolvedValue({ query: {} }) };
        mockScopesValidator = {
            hasValidScopesAsync: jest.fn().mockResolvedValue(true),
            verifyHasValidScopesAsync: jest.fn().mockResolvedValue(undefined),
            isAccessToResourceAllowedByAccessAndPatientScopes: jest.fn().mockResolvedValue(undefined)
        };
        mockRemoveHelper = { deleteManyAsync: jest.fn().mockResolvedValue(undefined) };
        mockPostRequestProcessor = { add: jest.fn() };

        const { GraphHelper } = require('../../../../operations/graph/graphHelpers');
        graphHelper = Object.create(GraphHelper.prototype);
        graphHelper.configManager = mockConfigManager;
        graphHelper.searchManager = mockSearchManager;
        graphHelper.scopesValidator = mockScopesValidator;
        graphHelper.removeHelper = mockRemoveHelper;
        graphHelper.postRequestProcessor = mockPostRequestProcessor;
        graphHelper.auditLogger = { logAuditEntryAsync: jest.fn().mockResolvedValue(undefined) };
        graphHelper.databaseQueryFactory = {
            createQuery: jest.fn().mockImplementation(({ resourceType }) => ({
                findAsync: async ({ query, options }) => {
                    capturedQueries.push({ resourceType, query, options });
                    return createCursor(docsByResourceType[resourceType] || []);
                }
            }))
        };
        graphHelper.bundleManager = {
            createRawBundle: jest.fn().mockImplementation(({ resources }) => ({
                resourceType: 'Bundle',
                type: 'searchset',
                entry: resources.map((r) => ({ resource: r }))
            })),
            // mirrors the real BundleManager.removeDuplicateEntries contract
            // (dedupe by resourceType + _uuid) so de-duplication is exercised for real
            removeDuplicateEntries: jest.fn().mockImplementation(({ entries }) => {
                const seen = new Set();
                return entries.filter((e) => {
                    const key = `${e.resource.resourceType}/${e.resource._uuid}`;
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
            })
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
            getFieldNameForSearchParameter: jest.fn().mockReturnValue('subject'),
            getPropertyObject: jest.fn().mockReturnValue(undefined)
        };
    });

    function makeParent (resource) {
        return new ResourceEntityAndContained({
            entityId: resource.id,
            entityUuid: resource._uuid,
            entityResourceType: resource.resourceType,
            includeInOutput: true,
            resource,
            containedEntries: []
        });
    }

    describe('getForwardReferencesAsync', () => {
        const patient = {
            resourceType: 'Patient',
            id: 'p1',
            _uuid: 'patient-uuid-1',
            managingOrganization: { _uuid: 'Organization/org-uuid-1', reference: 'Organization/org1' }
        };

        test('queries the referenced ids only and attaches the child to its parent', async () => {
            docsByResourceType.Organization = [
                { resourceType: 'Organization', id: 'org1', _uuid: 'org-uuid-1' }
            ];
            const parent = makeParent({ ...patient });

            const queryItem = await graphHelper.getForwardReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Organization',
                parentEntities: [parent],
                property: 'managingOrganization',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(graphHelper.r4ArgsParser.parseArgs.mock.calls[0][0].args.id).toBe('org-uuid-1');
            expect(queryItem.resourceType).toBe('Organization');
            expect(parent.containedEntries).toHaveLength(1);
            expect(parent.containedEntries[0].resource._uuid).toBe('org-uuid-1');
        });

        test('GraphDefinition target.params cannot override the id restriction', async () => {
            docsByResourceType.Organization = [];
            const parent = makeParent({ ...patient });

            await graphHelper.getForwardReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Organization',
                parentEntities: [parent],
                property: 'managingOrganization',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false,
                params: { id: 'attacker-controlled-id', status: 'active' }
            });

            const args = graphHelper.r4ArgsParser.parseArgs.mock.calls[0][0].args;
            expect(args.id).toBe('org-uuid-1');
            // the non-security param is still honoured as an additional AND filter
            expect(args.status).toBe('active');
        });

        test('GraphDefinition target.params cannot turn on _includeHidden', async () => {
            docsByResourceType.Organization = [];
            const parent = makeParent({ ...patient });

            await graphHelper.getForwardReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Organization',
                parentEntities: [parent],
                property: 'managingOrganization',
                parsedArgs: createParsedArgs({ _includeHidden: false }),
                supportLegacyId: false,
                params: { _includeHidden: true }
            });

            expect(graphHelper.r4ArgsParser.parseArgs.mock.calls[0][0].args._includeHidden).toBe(false);
        });

        test('returns undefined and issues no query for a resource type that does not exist', async () => {
            const parent = makeParent({ ...patient });
            const result = await graphHelper.getForwardReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'NotARealResource',
                parentEntities: [parent],
                property: 'managingOrganization',
                parsedArgs: createParsedArgs()
            });

            expect(result).toBeUndefined();
            expect(capturedQueries).toHaveLength(0);
        });

        test('returns undefined when no reference points at the requested target type', async () => {
            const parent = makeParent({ ...patient });
            const result = await graphHelper.getForwardReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Practitioner',
                parentEntities: [parent],
                property: 'managingOrganization',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(result).toBeUndefined();
            expect(mockSearchManager.constructQueryAsync).not.toHaveBeenCalled();
        });

        test('loop boundary: de-duplicates the id list when several parents share one reference', async () => {
            docsByResourceType.Organization = [];
            const parents = [
                makeParent({ ...patient, id: 'p1', _uuid: 'patient-uuid-1' }),
                makeParent({ ...patient, id: 'p2', _uuid: 'patient-uuid-2' }),
                makeParent({ ...patient, id: 'p3', _uuid: 'patient-uuid-3' })
            ];

            await graphHelper.getForwardReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Organization',
                parentEntities: parents,
                property: 'managingOrganization',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(graphHelper.r4ArgsParser.parseArgs.mock.calls[0][0].args.id).toBe('org-uuid-1');
        });

        test('logs an error and attaches nothing when the fetched child matches no parent', async () => {
            docsByResourceType.Organization = [
                { resourceType: 'Organization', id: 'other', _uuid: 'org-uuid-unrelated' }
            ];
            const parent = makeParent({ ...patient });

            await graphHelper.getForwardReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Organization',
                parentEntities: [parent],
                property: 'managingOrganization',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(parent.containedEntries).toHaveLength(0);
            expect(logging.logError).toHaveBeenCalledWith(
                expect.stringContaining('Organization/org-uuid-unrelated'), {}
            );
        });

        test('wraps downstream failures in a RethrownError naming the method', async () => {
            graphHelper.databaseQueryFactory.createQuery = jest.fn().mockImplementation(() => ({
                findAsync: async () => { throw new Error('mongo exploded'); }
            }));
            const parent = makeParent({ ...patient });

            await expect(
                graphHelper.getForwardReferencesAsync({
                    requestInfo,
                    base_version: '4_0_0',
                    resourceType: 'Organization',
                    parentEntities: [parent],
                    property: 'managingOrganization',
                    parsedArgs: createParsedArgs(),
                    supportLegacyId: false
                })
            ).rejects.toThrow('Error in getForwardReferencesAsync(): Organization');
        });
    });

    describe('getReverseReferencesAsync', () => {
        const patientResource = { resourceType: 'Patient', id: 'p1', _uuid: 'patient-uuid-1' };

        test('substitutes {ref} with typed parent references and attaches matching children', async () => {
            docsByResourceType.Condition = [
                {
                    resourceType: 'Condition',
                    id: 'c1',
                    _uuid: 'cond-uuid-1',
                    subject: { _uuid: 'Patient/patient-uuid-1' }
                }
            ];
            const parent = makeParent({ ...patientResource });

            const queryItem = await graphHelper.getReverseReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                relatedResourceType: 'Condition',
                parentEntities: [parent],
                filterProperty: null,
                filterValue: null,
                reverse_filter: 'patient={ref}',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            const parsedQueryString = graphHelper.r4ArgsParser.parseArgs.mock.calls[0][0].args;
            expect(parsedQueryString.patient).toBe('Patient/patient-uuid-1');
            expect(queryItem.resourceType).toBe('Condition');
            expect(parent.containedEntries).toHaveLength(1);
            expect(parent.containedEntries[0].resource._uuid).toBe('cond-uuid-1');
        });

        test('substitutes {id} with bare parent ids', async () => {
            docsByResourceType.Condition = [];
            const parent = makeParent({ ...patientResource });

            await graphHelper.getReverseReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                relatedResourceType: 'Condition',
                parentEntities: [parent],
                filterProperty: null,
                filterValue: null,
                reverse_filter: 'patient={id}',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(graphHelper.r4ArgsParser.parseArgs.mock.calls[0][0].args.patient)
                .toBe('patient-uuid-1');
        });

        test('adds proxy-patient references to the reverse filter for a Patient parent', async () => {
            docsByResourceType.Condition = [];
            const parent = makeParent({ ...patientResource });

            await graphHelper.getReverseReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                relatedResourceType: 'Condition',
                parentEntities: [parent],
                filterProperty: null,
                filterValue: null,
                reverse_filter: 'patient={ref}',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false,
                proxyPatientIds: ['person.abc']
            });

            expect(graphHelper.r4ArgsParser.parseArgs.mock.calls[0][0].args.patient)
                .toBe('Patient/patient-uuid-1,Patient/person.abc');
        });

        test('rejects with the original cause when reverse_filter is missing', async () => {
            let thrown;
            try {
                await graphHelper.getReverseReferencesAsync({
                    requestInfo,
                    base_version: '4_0_0',
                    parentResourceType: 'Patient',
                    relatedResourceType: 'Condition',
                    parentEntities: [makeParent({ ...patientResource })],
                    filterProperty: null,
                    filterValue: null,
                    reverse_filter: undefined,
                    parsedArgs: createParsedArgs()
                });
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeInstanceOf(Error);
            expect(thrown.original_error.message).toBe('reverse_filter must be set');
            expect(capturedQueries).toHaveLength(0);
        });

        test('rejects when the reverse-link search parameter cannot be resolved to a field', async () => {
            graphHelper.searchParametersManager.getFieldNameForSearchParameter.mockReturnValue(undefined);
            let thrown;
            try {
                await graphHelper.getReverseReferencesAsync({
                    requestInfo,
                    base_version: '4_0_0',
                    parentResourceType: 'Patient',
                    relatedResourceType: 'Condition',
                    parentEntities: [makeParent({ ...patientResource })],
                    filterProperty: null,
                    filterValue: null,
                    reverse_filter: 'bogus={ref}',
                    parsedArgs: createParsedArgs(),
                    supportLegacyId: false
                });
            } catch (e) {
                thrown = e;
            }
            expect(thrown.original_error.message)
                .toBe('bogus is not a valid search parameter for resource Condition');
        });

        test('loop boundary: returns without querying when every parent lacks a uuid', async () => {
            const result = await graphHelper.getReverseReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Observation',
                relatedResourceType: 'Condition',
                parentEntities: [],
                filterProperty: null,
                filterValue: null,
                reverse_filter: 'patient={ref}',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(result).toBeUndefined();
            expect(capturedQueries).toHaveLength(0);
        });

        test('subscription fallback attaches on client_person_id matching the Person parent', async () => {
            graphHelper.searchParametersManager.getFieldNameForSearchParameter.mockReturnValue('extension');
            docsByResourceType.SubscriptionStatus = [
                {
                    resourceType: 'SubscriptionStatus',
                    id: 's1',
                    _uuid: 'sub-uuid-1',
                    extension: [{
                        url: 'https://icanbwell.com/codes/client_person_id',
                        valueString: 'person-uuid-1'
                    }]
                }
            ];
            const parent = makeParent({ resourceType: 'Person', id: 'pr1', _uuid: 'person-uuid-1' });

            await graphHelper.getReverseReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Person',
                relatedResourceType: 'SubscriptionStatus',
                parentEntities: [parent],
                filterProperty: null,
                filterValue: null,
                reverse_filter: 'identifier={ref}',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(parent.containedEntries).toHaveLength(1);
            expect(parent.containedEntries[0].resource._uuid).toBe('sub-uuid-1');
        });

        test('a subscription naming a different Person is not attached to this parent', async () => {
            graphHelper.searchParametersManager.getFieldNameForSearchParameter.mockReturnValue('extension');
            docsByResourceType.SubscriptionStatus = [
                {
                    resourceType: 'SubscriptionStatus',
                    id: 's1',
                    _uuid: 'sub-uuid-foreign',
                    extension: [{
                        url: 'https://icanbwell.com/codes/client_person_id',
                        valueString: 'someone-elses-person'
                    }]
                }
            ];
            const parent = makeParent({ resourceType: 'Person', id: 'pr1', _uuid: 'person-uuid-1' });

            await graphHelper.getReverseReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Person',
                relatedResourceType: 'SubscriptionStatus',
                parentEntities: [parent],
                filterProperty: null,
                filterValue: null,
                reverse_filter: 'identifier={ref}',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(parent.containedEntries).toHaveLength(0);
            expect(logging.logError).toHaveBeenCalledWith(
                expect.stringContaining('Reverse Reference: No match found'), {}
            );
        });

        test('filterProperty rejects children whose value does not equal filterValue', async () => {
            docsByResourceType.Condition = [
                {
                    resourceType: 'Condition',
                    id: 'c1',
                    _uuid: 'cond-uuid-1',
                    status: 'entered-in-error',
                    subject: { _uuid: 'Patient/patient-uuid-1' }
                }
            ];
            const parent = makeParent({ ...patientResource });

            await graphHelper.getReverseReferencesAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                relatedResourceType: 'Condition',
                parentEntities: [parent],
                filterProperty: 'status',
                filterValue: 'active',
                reverse_filter: 'patient={ref}',
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(parent.containedEntries).toHaveLength(0);
        });
    });

    describe('getReverseLinkSearchParameterName', () => {
        test('prefers the parameter carrying the {ref} placeholder regardless of position', () => {
            const name = graphHelper.getReverseLinkSearchParameterName({
                relatedResourceType: 'Observation',
                parentResourceType: 'Patient',
                reverse_filter: 'status=final&subject={ref}'
            });
            expect(name).toBe('subject');
        });

        test('prefers the parameter carrying the {id} placeholder', () => {
            const name = graphHelper.getReverseLinkSearchParameterName({
                relatedResourceType: 'Observation',
                parentResourceType: 'Patient',
                reverse_filter: 'category=vital-signs&patient={id}'
            });
            expect(name).toBe('patient');
        });

        test('falls back to the reference parameter that targets the parent resource type', () => {
            graphHelper.searchParametersManager.getPropertyObject = jest.fn()
                .mockImplementation(({ queryParameter }) => {
                    if (queryParameter === 'performer') return { type: 'reference', target: ['Practitioner'] };
                    if (queryParameter === 'subject') return { type: 'reference', target: ['Patient'] };
                    return { type: 'token' };
                });

            const name = graphHelper.getReverseLinkSearchParameterName({
                relatedResourceType: 'Observation',
                parentResourceType: 'Patient',
                reverse_filter: 'status=final&performer=abc&subject=xyz'
            });
            expect(name).toBe('subject');
        });

        test('falls back to the first reference parameter when none targets the parent', () => {
            graphHelper.searchParametersManager.getPropertyObject = jest.fn()
                .mockImplementation(({ queryParameter }) =>
                    queryParameter === 'performer'
                        ? { type: 'reference', target: ['Practitioner'] }
                        : { type: 'token' }
                );

            const name = graphHelper.getReverseLinkSearchParameterName({
                relatedResourceType: 'Observation',
                parentResourceType: 'Patient',
                reverse_filter: 'status=final&performer=abc'
            });
            expect(name).toBe('performer');
        });

        test('falls back to the first parameter when nothing is a reference', () => {
            graphHelper.searchParametersManager.getPropertyObject = jest.fn().mockReturnValue({ type: 'token' });

            const name = graphHelper.getReverseLinkSearchParameterName({
                relatedResourceType: 'Observation',
                parentResourceType: 'Patient',
                reverse_filter: 'status=final&code=1234'
            });
            expect(name).toBe('status');
        });

        test('handles a filter with no key/value separator', () => {
            graphHelper.searchParametersManager.getPropertyObject = jest.fn().mockReturnValue(undefined);
            const name = graphHelper.getReverseLinkSearchParameterName({
                relatedResourceType: 'Observation',
                parentResourceType: 'Patient',
                reverse_filter: 'subject'
            });
            expect(name).toBe('subject');
        });
    });

    describe('getFilterFromPropertyPath / doesEntityHaveProperty', () => {
        test('splits a filtered path into property, filterProperty and filterValue', () => {
            expect(graphHelper.getFilterFromPropertyPath('link:assurance=level4'))
                .toEqual({ property: 'link', filterProperty: 'assurance', filterValue: 'level4' });
        });

        test('leaves an unfiltered path untouched', () => {
            expect(graphHelper.getFilterFromPropertyPath('managingOrganization'))
                .toEqual({ property: 'managingOrganization', filterProperty: undefined, filterValue: undefined });
        });

        test('drops the filter when the segment after ":" has no "="', () => {
            expect(graphHelper.getFilterFromPropertyPath('subject:missing'))
                .toEqual({ property: 'subject', filterProperty: undefined, filterValue: undefined });
        });

        test('nested property with a matching filter value is reported as present', () => {
            const entity = makeParent({
                resourceType: 'Person',
                id: 'pr1',
                _uuid: 'person-1',
                link: [{ target: { type: 'Patient', _uuid: 'Patient/x' } }]
            });
            expect(graphHelper.doesEntityHaveProperty({
                entity, property: 'link.target', filterProperty: 'type', filterValue: 'Patient'
            })).toBe(true);
        });

        test('nested property with a non-matching filter value is reported as absent', () => {
            const entity = makeParent({
                resourceType: 'Person',
                id: 'pr1',
                _uuid: 'person-1',
                link: [{ target: { type: 'Practitioner', _uuid: 'Practitioner/x' } }]
            });
            expect(graphHelper.doesEntityHaveProperty({
                entity, property: 'link.target', filterProperty: 'type', filterValue: 'Patient'
            })).toBe(false);
        });

        test('an object-valued top-level property is detected as present', () => {
            const entity = makeParent({
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'pat-1',
                managingOrganization: { _uuid: 'Organization/org-1' }
            });
            expect(Boolean(graphHelper.doesEntityHaveProperty({
                entity, property: 'managingOrganization'
            }))).toBe(true);
            expect(Boolean(graphHelper.doesEntityHaveProperty({
                entity, property: 'generalPractitioner'
            }))).toBe(false);
        });

        test('missing nested property is reported as absent', () => {
            const entity = makeParent({ resourceType: 'Person', id: 'pr1', _uuid: 'person-1' });
            expect(graphHelper.doesEntityHaveProperty({
                entity, property: 'link.target'
            })).toBe(false);
        });
    });

    describe('getRecursiveContainedEntities', () => {
        test('flattens a two-level contained tree into bundle entries in depth-first order', () => {
            const grandChild = makeParent({ resourceType: 'Organization', id: 'o1', _uuid: 'org-1' });
            const child = makeParent({ resourceType: 'Encounter', id: 'e1', _uuid: 'enc-1' });
            child.containedEntries = [grandChild];
            const root = makeParent({ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' });
            root.containedEntries = [child];

            const result = graphHelper.getRecursiveContainedEntities(root);

            expect(result.map((e) => e.id)).toEqual(['p1', 'e1', 'o1']);
        });

        test('omits entities the caller did not request but still walks their children', () => {
            const child = makeParent({ resourceType: 'Encounter', id: 'e1', _uuid: 'enc-1' });
            const root = makeParent({ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' });
            root.includeInOutput = false;
            root.containedEntries = [child];

            const result = graphHelper.getRecursiveContainedEntities(root);

            expect(result.map((e) => e.id)).toEqual(['e1']);
        });
    });

    describe('processLinkTargetAsync', () => {
        test('a forward link is not fetched when the caller lacks scope for the target type', async () => {
            mockScopesValidator.hasValidScopesAsync.mockResolvedValue(false);
            const parent = makeParent({
                resourceType: 'Patient',
                id: 'p1',
                _uuid: 'pat-1',
                managingOrganization: { _uuid: 'Organization/org-1' }
            });

            const result = await graphHelper.processLinkTargetAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                link: { path: 'managingOrganization' },
                parentEntities: [parent],
                target: { type: 'Organization' },
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(capturedQueries).toHaveLength(0);
            expect(result.queryItems).toEqual([]);
            expect(parent.containedEntries).toHaveLength(0);
        });

        test('a reverse link is not fetched when the caller lacks scope for the target type', async () => {
            mockScopesValidator.hasValidScopesAsync.mockResolvedValue(false);
            const parent = makeParent({ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' });

            const result = await graphHelper.processLinkTargetAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                link: { params: 'patient={ref}' },
                parentEntities: [parent],
                target: { type: 'Condition', params: 'patient={ref}' },
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(capturedQueries).toHaveLength(0);
            expect(result.queryItems).toEqual([]);
        });

        test('recurses into child links and returns a query item per traversal level', async () => {
            docsByResourceType.Encounter = [
                {
                    resourceType: 'Encounter',
                    id: 'e1',
                    _uuid: 'enc-1',
                    subject: { _uuid: 'Patient/pat-1' }
                }
            ];
            docsByResourceType.Organization = [];
            const parent = makeParent({ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' });

            const result = await graphHelper.processLinkTargetAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                link: { params: 'patient={ref}' },
                parentEntities: [parent],
                target: {
                    type: 'Encounter',
                    params: 'patient={ref}',
                    link: [{ path: 'serviceProvider', target: [{ type: 'Organization' }] }]
                },
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(result.childEntries.map((c) => c.resource._uuid)).toEqual(['enc-1']);
            expect(result.queryItems.map((q) => q.resourceType)).toEqual(['Encounter']);
        });

        test('a reverse link without a target type performs no traversal', async () => {
            const parent = makeParent({ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' });

            const result = await graphHelper.processLinkTargetAsync({
                requestInfo,
                base_version: '4_0_0',
                parentResourceType: 'Patient',
                link: { params: 'patient={ref}' },
                parentEntities: [parent],
                target: { params: 'patient={ref}' },
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(result.queryItems).toEqual([]);
            expect(capturedQueries).toHaveLength(0);
        });
    });

    describe('processMultipleIdsAsync / processGraphAsync', () => {
        test('returns the top level resource plus its related entries, de-duplicated', async () => {
            docsByResourceType.Patient = [{ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' }];
            docsByResourceType.Condition = [
                { resourceType: 'Condition', id: 'c1', _uuid: 'cond-1', subject: { _uuid: 'Patient/pat-1' } }
            ];

            const result = await graphHelper.processMultipleIdsAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Patient',
                graphDefinition: { link: [{ params: 'patient={ref}', target: [{ type: 'Condition', params: 'patient={ref}' }] }] },
                contained: false,
                parsedArgs: createParsedArgs(),
                idsAlreadyProcessed: [],
                supportLegacyId: false
            });

            expect(result.entries.map((e) => e.resource._uuid)).toEqual(['pat-1', 'cond-1']);
        });

        test('contained=true nests the related resources inside the top level resource', async () => {
            docsByResourceType.Patient = [{ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' }];
            docsByResourceType.Condition = [
                { resourceType: 'Condition', id: 'c1', _uuid: 'cond-1', subject: { _uuid: 'Patient/pat-1' } }
            ];

            const result = await graphHelper.processMultipleIdsAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Patient',
                graphDefinition: { link: [{ params: 'patient={ref}', target: [{ type: 'Condition', params: 'patient={ref}' }] }] },
                contained: true,
                parsedArgs: createParsedArgs(),
                idsAlreadyProcessed: [],
                supportLegacyId: false
            });

            const topLevel = result.entries.find((e) => e.resource.resourceType === 'Patient');
            expect(topLevel.resource.contained.map((r) => r._uuid)).toEqual(['cond-1']);
            expect(result.entries.map((e) => e.resource._uuid)).toEqual(['pat-1']);
        });

        test('streaming mode writes each entry once and returns an empty entry list', async () => {
            docsByResourceType.Patient = [{ resourceType: 'Patient', id: 'p1', _uuid: 'pat-1' }];
            const written = [];

            const result = await graphHelper.processMultipleIdsAsync({
                base_version: '4_0_0',
                requestInfo,
                resourceType: 'Patient',
                graphDefinition: { link: [] },
                contained: false,
                parsedArgs: createParsedArgs(),
                responseStreamer: {
                    writeBundleEntryAsync: jest.fn().mockImplementation(async ({ bundleEntry }) => {
                        written.push(bundleEntry.resource._uuid);
                    })
                },
                idsAlreadyProcessed: [],
                supportLegacyId: false
            });

            expect(written).toEqual(['pat-1']);
            expect(result.entries).toEqual([]);
        });

        test('loop boundary: ids beyond graphBatchSize are split into chunks', async () => {
            mockConfigManager.graphBatchSize = 2;
            graphHelper.processMultipleIdsAsync = jest.fn().mockResolvedValue({
                entries: [], queryItems: [], options: [], explanations: [], bundleEntryIdsProcessed: []
            });
            const parsedArgs = createParsedArgs({
                get: jest.fn().mockImplementation((k) =>
                    k === 'id' ? { queryParameterValue: { values: ['a', 'b', 'c', 'd', 'e'] } } : undefined
                )
            });

            await graphHelper.processGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                contained: false,
                parsedArgs,
                supportLegacyId: false
            });

            const calls = graphHelper.processMultipleIdsAsync.mock.calls;
            expect(calls).toHaveLength(3);
            expect(calls.map((c) => c[0].graphChunkIndex)).toEqual([0, 1, 2]);
        });

        test('Person $graph derives a proxy-patient id for every requested Person id', async () => {
            graphHelper.processMultipleIdsAsync = jest.fn().mockResolvedValue({
                entries: [], queryItems: [], options: [], explanations: [], bundleEntryIdsProcessed: []
            });
            const parsedArgs = createParsedArgs({
                get: jest.fn().mockImplementation((k) =>
                    k === 'id' ? { queryParameterValue: { values: ['person-a', 'person-b'] } } : undefined
                )
            });
            mockConfigManager.graphBatchSize = 10;

            await graphHelper.processGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Person',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                contained: false,
                parsedArgs,
                supportLegacyId: false
            });

            expect(graphHelper.processMultipleIdsAsync.mock.calls[0][0].proxyPatientIds)
                .toEqual(['person.person-a', 'person.person-b']);
        });

        test('Patient $graph keeps only proxy-prefixed ids as proxy patients', async () => {
            graphHelper.processMultipleIdsAsync = jest.fn().mockResolvedValue({
                entries: [], queryItems: [], options: [], explanations: [], bundleEntryIdsProcessed: []
            });
            const parsedArgs = createParsedArgs({
                get: jest.fn().mockImplementation((k) =>
                    k === 'id' ? { queryParameterValue: { values: ['real-patient', 'person.proxy-a'] } } : undefined
                )
            });
            mockConfigManager.graphBatchSize = 10;

            await graphHelper.processGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                contained: false,
                parsedArgs,
                supportLegacyId: false
            });

            expect(graphHelper.processMultipleIdsAsync.mock.calls[0][0].proxyPatientIds)
                .toEqual(['person.proxy-a']);
        });
    });

    describe('deleteGraphAsync', () => {
        function stubGraphBundle (resources) {
            graphHelper.processGraphAsync = jest.fn().mockResolvedValue({
                entry: resources.map((r) => ({ resource: r }))
            });
        }

        test('never deletes AuditEvent resources found in the graph', async () => {
            stubGraphBundle([{ resourceType: 'AuditEvent', id: 'a1', _uuid: 'audit-1' }]);

            const bundle = await graphHelper.deleteGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
            expect(bundle.total).toBe(0);
        });

        test('skips a resource whose security tags the caller cannot write (fail-closed)', async () => {
            stubGraphBundle([
                { resourceType: 'Condition', id: 'c1', _uuid: 'cond-1' },
                { resourceType: 'Observation', id: 'o1', _uuid: 'obs-1' }
            ]);
            mockScopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockImplementation(async ({ resource }) => {
                    if (resource.resourceType === 'Condition') {
                        throw new Error('no write access');
                    }
                });

            const bundle = await graphHelper.deleteGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(mockRemoveHelper.deleteManyAsync).toHaveBeenCalledTimes(1);
            expect(mockRemoveHelper.deleteManyAsync.mock.calls[0][0].resourceType).toBe('Observation');
            expect(bundle.total).toBe(1);
            expect(bundle.entry[0].resource.id).toBe('o1');
            expect(logging.logWarn).toHaveBeenCalledWith(
                expect.stringContaining('Skipping deletion of Condition/c1'),
                expect.anything()
            );
        });

        test('deletes allowed resources, enqueues an audit entry and emits a DELETE bundle request', async () => {
            stubGraphBundle([{ resourceType: 'Condition', id: 'c1', _uuid: 'cond-1' }]);

            const bundle = await graphHelper.deleteGraphAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                parsedArgs: createParsedArgs(),
                supportLegacyId: false
            });

            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Condition', accessRequested: 'write' })
            );
            expect(mockPostRequestProcessor.add).toHaveBeenCalledTimes(1);
            expect(bundle.type).toBe('batch-response');
            expect(bundle.entry[0].request.method).toBe('DELETE');
            expect(bundle.entry[0].request.url).toBe('/4_0_0/Condition/c1');
        });

        test('refuses the whole delete when scope verification throws', async () => {
            stubGraphBundle([{ resourceType: 'Condition', id: 'c1', _uuid: 'cond-1' }]);
            mockScopesValidator.verifyHasValidScopesAsync.mockRejectedValue(new Error('missing write scope'));

            await expect(
                graphHelper.deleteGraphAsync({
                    requestInfo,
                    base_version: '4_0_0',
                    resourceType: 'Patient',
                    graphDefinitionJson: { resourceType: 'GraphDefinition', link: [] },
                    parsedArgs: createParsedArgs(),
                    supportLegacyId: false
                })
            ).rejects.toThrow('Error in deleteGraphAsync()');
            expect(mockRemoveHelper.deleteManyAsync).not.toHaveBeenCalled();
        });
    });
});
