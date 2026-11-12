'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// request-scoped store: a plain Map stands in for express-http-context's AsyncLocalStorage
const mockStore = new Map();
jest.mock('express-http-context', () => ({
    get: (k) => mockStore.get(k),
    set: (k, v) => mockStore.set(k, v)
}));

const { PatientDataViewControlExclusion } = require('../../../utils/patientDataViewControlExclusion');
const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../operations/query/queryParameterValue');
const { searchParameterQueries } = require('../../../searchParameters/searchParameters');
const { ViewControlSubject } = require('../../../utils/viewControlSubject');
const { HTTP_CONTEXT_KEYS } = require('../../../constants');
const { ScopesManager } = require('../../../operations/security/scopesManager');

const UUID_A = '5f1e3b2a-1111-4c2b-9d3e-000000000001';

function mockOf (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('PatientDataViewControlExclusion', () => {
    let exclusion;
    let getConsentAsync;
    let getPatientIdsFromScopeAsync;
    let findPersonAsync;
    let getAccessCodesFromScopes;
    let enrolled;
    const user = { isUser: true, personIdFromJwtToken: 'person-1' };

    const newParsedArgs = () => new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [] });
    const idNotItems = (parsedArgs) =>
        parsedArgs.parsedArgItems.filter((i) => i.queryParameter === '_id' && i.modifiers.includes('not'));

    beforeEach(() => {
        mockStore.clear();
        enrolled = ['clientA'];
        const configManager = mockOf(ConfigManager);
        Object.defineProperty(configManager, 'clientsWithDataConnectionViewControl', { get: () => enrolled });
        getConsentAsync = jest.fn().mockResolvedValue({
            viewControlResourceToExcludeMap: { CarePlan: [UUID_A, 'source-id-1'] }
        });
        const manager = mockOf(PatientDataViewControlManager);
        manager.getConsentAsync = getConsentAsync;
        findPersonAsync = jest.fn().mockResolvedValue({ uuid: 'url-person-uuid', owner: 'clientA' });
        manager.findPersonAsync = findPersonAsync;
        const scopeManager = mockOf(PatientScopeManager);
        // walking the member's Person records its owner in httpContext, as PersonToPatientIdsExpander does
        getPatientIdsFromScopeAsync = jest.fn().mockImplementation(async ({ personIdFromJwtToken }) => {
            mockStore.set(`personOwnerFor-${personIdFromJwtToken}`, 'clientA');
            return [];
        });
        scopeManager.getPatientIdsFromScopeAsync = getPatientIdsFromScopeAsync;
        // by default the caller's access scopes cover the enrolled owner
        getAccessCodesFromScopes = jest.fn().mockReturnValue(['clientA']);
        const scopesManager = mockOf(ScopesManager);
        scopesManager.getAccessCodesFromScopes = getAccessCodesFromScopes;
        exclusion = new PatientDataViewControlExclusion({
            configManager,
            patientDataViewControlManager: manager,
            patientScopeManager: scopeManager,
            scopesManager
        });
    });

    test('adds one _id:not item with the $or operator for a blocked resource type', async () => {
        const parsedArgs = newParsedArgs();
        await exclusion.applyAsync({ parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user });
        const items = idNotItems(parsedArgs);
        expect(items).toHaveLength(1);
        expect(items[0].queryParameterValue.values).toEqual([UUID_A, 'source-id-1']);
        // '$and' over a mixed uuid/sourceId list would make $nor exclude nothing
        expect(items[0].queryParameterValue.operator).toBe('$or');
        expect(getPatientIdsFromScopeAsync).toHaveBeenCalledWith(
            expect.objectContaining({ addPersonOwnerToContext: true, personIdFromJwtToken: 'person-1' })
        );
        // the member's Person and the owner recorded by walking it; getConsentAsync fails the request
        // when the owner is missing
        expect(getConsentAsync).toHaveBeenCalledWith(
            expect.objectContaining({ personId: 'person-1', owner: 'clientA' })
        );
    });

    test.each(['_id', 'id'])(
        'folds a caller-supplied %s:not into one exclusion instead of overwriting or repeating it',
        async (queryParameter) => {
            const parsedArgs = newParsedArgs();
            parsedArgs.add(new ParsedArgsItem({
                queryParameter,
                queryParameterValue: new QueryParameterValue({ value: 'caller-excluded', operator: '$or' }),
                propertyObj: searchParameterQueries.Resource._id,
                modifiers: ['not']
            }));
            await exclusion.applyAsync({ parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user });
            const items = parsedArgs.parsedArgItems.filter(
                (i) => ['_id', 'id'].includes(i.queryParameter) && i.modifiers.includes('not')
            );
            expect(items).toHaveLength(1);
            expect(items[0].queryParameterValue.values).toEqual(
                expect.arrayContaining([UUID_A, 'source-id-1', 'caller-excluded'])
            );
        }
    );

    test.each([
        ['resource type not mentioned in the Consent', { resourceType: 'Condition', requestInfo: user }],
        ['service token (isUser false)', { resourceType: 'CarePlan', requestInfo: { isUser: false, personIdFromJwtToken: 'person-1' } }],
        ['user token without a person id', { resourceType: 'CarePlan', requestInfo: { isUser: true } }],
        ['no requestInfo', { resourceType: 'CarePlan', requestInfo: undefined }]
    ])('leaves parsedArgs untouched: %s', async (_name, { resourceType, requestInfo }) => {
        const parsedArgs = newParsedArgs();
        await exclusion.applyAsync({ parsedArgs, resourceType, base_version: '4_0_0', requestInfo });
        expect(idNotItems(parsedArgs)).toHaveLength(0);
    });

    test.each([
        ['a blocked resource type', 'CarePlan'],
        // a Composition search still needs the CarePlan ids, to drop sections that reference them
        ['a resource type the Consent does not mention', 'Composition']
    ])('records the whole exclude map on parsedArgs for %s', async (_name, resourceType) => {
        const parsedArgs = newParsedArgs();
        await exclusion.applyAsync({ parsedArgs, resourceType, base_version: '4_0_0', requestInfo: user });
        expect(parsedArgs.viewControlExcludeMap).toEqual({ CarePlan: [UUID_A, 'source-id-1'] });
        expect(Object.isFrozen(parsedArgs.viewControlExcludeMap)).toBe(true);
    });

    test('records an empty exclude map for a service token', async () => {
        const parsedArgs = newParsedArgs();
        await exclusion.applyAsync({
            parsedArgs, resourceType: 'Composition', base_version: '4_0_0', requestInfo: { isUser: false }
        });
        expect(parsedArgs.viewControlExcludeMap).toEqual({});
    });

    test('does no work at all when no client is enrolled (no Person traversal, no Consent search)', async () => {
        enrolled = [];
        await exclusion.applyAsync({
            parsedArgs: newParsedArgs(), resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user
        });
        expect(getPatientIdsFromScopeAsync).not.toHaveBeenCalled();
        expect(getConsentAsync).not.toHaveBeenCalled();
    });

    test('a member whose Person was not found gets an empty result without a Consent search', async () => {
        // the Person walk ran and recorded that it found no Person
        getPatientIdsFromScopeAsync.mockImplementation(async ({ personIdFromJwtToken }) => {
            mockStore.set(`personOwnerFor-${personIdFromJwtToken}`, HTTP_CONTEXT_KEYS.PERSON_OWNER_NOT_FOUND);
            return [];
        });
        const parsedArgs = newParsedArgs();
        await exclusion.applyAsync({ parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user });
        expect(getConsentAsync).not.toHaveBeenCalled();
        expect(parsedArgs.viewControlExcludeMap).toEqual({});
        expect(idNotItems(parsedArgs)).toHaveLength(0);
    });

    test('fails closed when the Person walk records no outcome for the member (no owner, no not-found)', async () => {
        // e.g. the Person is found but its owner is not written under the token's person id
        getPatientIdsFromScopeAsync.mockResolvedValue([]);
        await expect(exclusion.applyAsync({
            parsedArgs: newParsedArgs(), resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user
        })).rejects.toThrow('recorded neither the Person owner nor that the Person was not found');
        expect(getConsentAsync).not.toHaveBeenCalled();
    });

    test('a member whose Person has no owner tag still reaches getConsentAsync, which fails the request', async () => {
        // the Person walk found the Person and recorded that it has no owner
        getPatientIdsFromScopeAsync.mockImplementation(async ({ personIdFromJwtToken }) => {
            mockStore.set(`personOwnerFor-${personIdFromJwtToken}`, null);
            return [];
        });
        getConsentAsync.mockRejectedValue(new Error('the Person has no owner tag'));
        await expect(exclusion.applyAsync({
            parsedArgs: newParsedArgs(), resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user
        })).rejects.toThrow('no owner tag');
        expect(getConsentAsync).toHaveBeenCalledWith(expect.objectContaining({ personId: 'person-1', owner: null }));
    });

    test('enrollment of the caller is delegated to getConsentAsync: an empty map changes nothing', async () => {
        getConsentAsync.mockResolvedValue({ viewControlResourceToExcludeMap: {} });
        const parsedArgs = newParsedArgs();
        await exclusion.applyAsync({ parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user });
        expect(idNotItems(parsedArgs)).toHaveLength(0);
    });

    test('loads the Consent once per request even for concurrent callers (GraphQL resolvers)', async () => {
        await Promise.all(
            ['CarePlan', 'CarePlan', 'Condition', 'CarePlan'].map((resourceType) =>
                exclusion.applyAsync({
                    parsedArgs: newParsedArgs(), resourceType, base_version: '4_0_0', requestInfo: user
                })
            )
        );
        expect(getConsentAsync).toHaveBeenCalledTimes(1);
        expect(getPatientIdsFromScopeAsync).toHaveBeenCalledTimes(1);
    });

    test('getConsentLookupAsync returns the Consent queries and options alongside the exclude map', async () => {
        getConsentAsync.mockResolvedValue({
            viewControlResourceToExcludeMap: { CarePlan: [UUID_A] },
            viewControlConsentQueries: [{ collectionName: 'Consent_4_0_0' }],
            viewControlConsentQueryOptions: [{ limit: 10 }]
        });
        const lookup = await exclusion.getConsentLookupAsync({ requestInfo: user, base_version: '4_0_0' });
        expect(lookup).toEqual({
            viewControlResourceToExcludeMap: { CarePlan: [UUID_A] },
            viewControlConsentQueries: [{ collectionName: 'Consent_4_0_0' }],
            viewControlConsentQueryOptions: [{ limit: 10 }]
        });
    });

    test('the shared lookup is frozen, so one consumer cannot change another consumer\'s filter', async () => {
        const lookup = await exclusion.getConsentLookupAsync({ requestInfo: user, base_version: '4_0_0' });
        // array methods throw on a frozen array in strict and non-strict code alike
        expect(() => lookup.viewControlResourceToExcludeMap.CarePlan.push('caller-excluded')).toThrow(TypeError);
        // plain assignment throws only in strict mode (this file); most consumers are not strict,
        // where it is silently ignored. Either way the shared lookup must be unchanged.
        const tryAssign = (fn) => {
            try {
                fn();
            } catch {
                // rejected in strict mode
            }
        };
        tryAssign(() => { lookup.viewControlResourceToExcludeMap.Condition = ['x']; });
        tryAssign(() => { lookup.viewControlResourceToExcludeMap.CarePlan[0] = 'replaced'; });
        const again = await exclusion.getConsentLookupAsync({ requestInfo: user, base_version: '4_0_0' });
        expect(again.viewControlResourceToExcludeMap).toEqual({ CarePlan: [UUID_A, 'source-id-1'] });
    });

    test.each([
        ['service token', { isUser: false, personIdFromJwtToken: 'person-1' }],
        ['user token without a person id', { isUser: true }],
        ['no requestInfo', undefined]
    ])('getConsentLookupAsync returns an empty result without any lookup: %s', async (_name, requestInfo) => {
        const lookup = await exclusion.getConsentLookupAsync({ requestInfo, base_version: '4_0_0' });
        expect(lookup).toEqual({
            viewControlResourceToExcludeMap: {},
            viewControlConsentQueries: [],
            viewControlConsentQueryOptions: []
        });
        expect(getConsentAsync).not.toHaveBeenCalled();
        expect(getPatientIdsFromScopeAsync).not.toHaveBeenCalled();
    });

    describe('a URL Person subject (service-token opt-in)', () => {
        const service = { isUser: false };
        const urlSubject = ViewControlSubject.fromUrlPerson({ personId: 'person-from-url' });

        test('reads the URL Person through the caller\'s access filter and keys the Consent on its uuid', async () => {
            const parsedArgs = newParsedArgs();
            await exclusion.applyAsync({
                parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: service, subject: urlSubject
            });
            expect(findPersonAsync).toHaveBeenCalledWith(
                expect.objectContaining({ requestInfo: service, personId: 'person-from-url' })
            );
            expect(getConsentAsync).toHaveBeenCalledWith(
                expect.objectContaining({ personId: 'url-person-uuid', owner: 'clientA' })
            );
            // the service token has no member Person to walk
            expect(getPatientIdsFromScopeAsync).not.toHaveBeenCalled();
            expect(idNotItems(parsedArgs)).toHaveLength(1);
        });

        test('a service token without a subject is unaffected (no lookup)', async () => {
            const parsedArgs = newParsedArgs();
            await exclusion.applyAsync({ parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: service });
            expect(idNotItems(parsedArgs)).toHaveLength(0);
            expect(findPersonAsync).not.toHaveBeenCalled();
            expect(getConsentAsync).not.toHaveBeenCalled();
        });

        test('an explicit null subject turns the filter off, even for a member token', async () => {
            const parsedArgs = newParsedArgs();
            await exclusion.applyAsync({
                parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user, subject: null
            });
            expect(idNotItems(parsedArgs)).toHaveLength(0);
            expect(getConsentAsync).not.toHaveBeenCalled();
        });

        test('each subject is looked up once per request, separately from the member in the token', async () => {
            await Promise.all([
                exclusion.getConsentLookupAsync({ requestInfo: user, base_version: '4_0_0', subject: urlSubject }),
                exclusion.getConsentLookupAsync({ requestInfo: user, base_version: '4_0_0', subject: urlSubject }),
                exclusion.getConsentLookupAsync({ requestInfo: user, base_version: '4_0_0' })
            ]);
            expect(findPersonAsync).toHaveBeenCalledTimes(1);
            expect(getConsentAsync).toHaveBeenCalledTimes(2);
        });

        test.each([
            ['covers the owner', ['clientA'], true],
            ['covers the owner among others', ['clientB', 'clientA'], true],
            ['is the * wildcard', ['*'], true],
            ['does not cover the owner', ['clientB'], false]
        ])('a service token whose search access %s', async (_name, accessCodes, allowed) => {
            getAccessCodesFromScopes.mockReturnValue(accessCodes);
            const lookup = exclusion.getConsentLookupAsync({
                requestInfo: { isUser: false, user: 'svc', scope: 'access/x.*' },
                base_version: '4_0_0',
                subject: urlSubject
            });
            if (allowed) {
                await expect(lookup).resolves.toBeDefined();
                expect(getConsentAsync).toHaveBeenCalledTimes(1);
            } else {
                // fails closed: a Consent it can't see would look like no Consent and hide nothing
                await expect(lookup).rejects.toMatchObject({ statusCode: 403 });
                expect(getConsentAsync).not.toHaveBeenCalled();
            }
            expect(getAccessCodesFromScopes).toHaveBeenCalledWith('s', 'svc', 'access/x.*');
        });

        test('the owner scope check is skipped when the Person\'s owner is not enrolled', async () => {
            findPersonAsync.mockResolvedValueOnce({ uuid: 'url-person-uuid', owner: 'clientZ' });
            getAccessCodesFromScopes.mockReturnValue(['clientB']);
            await exclusion.getConsentLookupAsync({ requestInfo: service, base_version: '4_0_0', subject: urlSubject });
            expect(getAccessCodesFromScopes).not.toHaveBeenCalled();
        });

        test('a Person the caller cannot see fails the lookup (404 from findPersonAsync)', async () => {
            findPersonAsync.mockRejectedValueOnce(Object.assign(new Error('Person not found'), { statusCode: 404 }));
            await expect(exclusion.getConsentLookupAsync({
                requestInfo: service, base_version: '4_0_0', subject: urlSubject
            })).rejects.toMatchObject({ statusCode: 404 });
            expect(getConsentAsync).not.toHaveBeenCalled();
        });
    });

    test('fails closed: a Consent lookup error propagates and is not memoized', async () => {
        getConsentAsync.mockRejectedValueOnce(new Error('mongo down'));
        await expect(
            exclusion.applyAsync({
                parsedArgs: newParsedArgs(), resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user
            })
        ).rejects.toThrow('mongo down');
        const parsedArgs = newParsedArgs();
        await exclusion.applyAsync({ parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user });
        expect(idNotItems(parsedArgs)).toHaveLength(1);
    });
});
