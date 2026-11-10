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

const UUID_A = '5f1e3b2a-1111-4c2b-9d3e-000000000001';

function mockOf (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('PatientDataViewControlExclusion', () => {
    let exclusion;
    let getConsentAsync;
    let getPatientIdsFromScopeAsync;
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
        const scopeManager = mockOf(PatientScopeManager);
        getPatientIdsFromScopeAsync = jest.fn().mockResolvedValue([]);
        scopeManager.getPatientIdsFromScopeAsync = getPatientIdsFromScopeAsync;
        exclusion = new PatientDataViewControlExclusion({
            configManager,
            patientDataViewControlManager: manager,
            patientScopeManager: scopeManager
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
        // a Person with no owner tag fails the request rather than being treated as enrolled
        expect(getConsentAsync).toHaveBeenCalledWith(
            expect.objectContaining({ raiseErrorForMissingUserOwner: true })
        );
    });

    test('folds a caller-supplied _id:not into the exclusion instead of overwriting it', async () => {
        const parsedArgs = newParsedArgs();
        parsedArgs.add(new ParsedArgsItem({
            queryParameter: '_id',
            queryParameterValue: new QueryParameterValue({ value: 'caller-excluded', operator: '$or' }),
            propertyObj: searchParameterQueries.Resource._id,
            modifiers: ['not']
        }));
        await exclusion.applyAsync({ parsedArgs, resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user });
        const items = idNotItems(parsedArgs);
        expect(items).toHaveLength(1);
        expect(items[0].queryParameterValue.values).toEqual(
            expect.arrayContaining([UUID_A, 'source-id-1', 'caller-excluded'])
        );
    });

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

    test('does no work at all when no client is enrolled (no Person traversal, no Consent search)', async () => {
        enrolled = [];
        await exclusion.applyAsync({
            parsedArgs: newParsedArgs(), resourceType: 'CarePlan', base_version: '4_0_0', requestInfo: user
        });
        expect(getPatientIdsFromScopeAsync).not.toHaveBeenCalled();
        expect(getConsentAsync).not.toHaveBeenCalled();
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
