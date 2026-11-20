const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { AccessFilteredFinder } = require('../../../../../../operations/writePipeline/steps/load/accessFilteredFinder');
const { SearchManager } = require('../../../../../../operations/search/searchManager');
const { DatabaseQueryFactory } = require('../../../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { FhirResourceWriteSerializer } = require('../../../../../../fhir/fhirResourceWriteSerializer');
const BaseSerializer = require('../../../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');
const { SecurityTagSystem } = require('../../../../../../utils/securityTagSystem');
const { OPERATIONS: { WRITE } } = require('../../../../../../constants');

/**
 * The `_uuid` of the synthetic Person in the database.
 */
const PERSON_UUID = '00000000-0000-4000-8000-0000000000a1';

/**
 * The caller's request info: a synthetic user that holds the access scope of one tenant.
 */
const REQUEST_INFO = Object.freeze({
    requestId: 'synthetic-request',
    user: 'synthetic-user',
    scope: 'user/*.* access/client.*',
    isUser: false,
    personIdFromJwtToken: 'synthetic-person'
});

/**
 * The query the faked search manager returns, so a test can see it reach the database query.
 */
const QUERY = Object.freeze({ _uuid: PERSON_UUID, 'meta.security.code': 'client' });

/**
 * Builds a Person as the database returns it: with the Mongo `_id` and a field the schema does not
 * know, which the write serialization drops.
 */
const buildRawPerson = (uuid = PERSON_UUID) => ({
    _id: 'synthetic-mongo-id',
    resourceType: 'Person',
    id: 'synthetic-person-id',
    _uuid: uuid,
    _sourceAssigningAuthority: 'client',
    meta: {
        versionId: '1',
        security: [
            { system: SecurityTagSystem.access, code: 'client' },
            { system: SecurityTagSystem.sourceAssigningAuthority, code: 'client' }
        ]
    },
    notAFhirField: 'dropped'
});

/**
 * Builds a config manager whose `useAccessIndex` is the given value.
 */
const buildConfigManager = (useAccessIndex) => {
    const configManager = Object.create(ConfigManager.prototype);
    Object.defineProperty(configManager, 'useAccessIndex', { value: useAccessIndex });
    return configManager;
};

/**
 * Builds the finder with faked boundaries: the search manager returns `QUERY`, and the database
 * returns `matches` for the find. Each call to the boundaries is recorded in `calls`. A
 * `searchError` makes the search manager throw it.
 */
const buildFinder = ({ matches = [], useAccessIndex = false, searchError = null } = {}) => {
    const calls = { construct: [], create: [], find: [] };
    const searchManager = Object.create(SearchManager.prototype);
    searchManager.constructQueryAsync = async (args) => {
        calls.construct.push(args);
        if (searchError) {
            throw searchError;
        }
        return { query: QUERY };
    };
    const databaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
    databaseQueryFactory.createQuery = (args) => {
        calls.create.push(args);
        return {
            findAsync: async (findArgs) => {
                calls.find.push(findArgs);
                return { toArrayAsync: async () => matches };
            }
        };
    };
    const finder = new AccessFilteredFinder({
        searchManager,
        databaseQueryFactory,
        configManager: buildConfigManager(useAccessIndex)
    });
    return { finder, calls };
};

/**
 * Builds the arguments of `findAsync`, with the given overrides.
 */
const buildFindArgs = (overrides = {}) => ({
    requestInfo: REQUEST_INFO,
    base_version: '4_0_0',
    resourceType: 'Person',
    parsedArgs: { base_version: '4_0_0', id: PERSON_UUID },
    accessRequested: 'u',
    currentOperationName: 'admin',
    ...overrides
});

describe('AccessFilteredFinder', () => {
    let previousSerializerConfig;

    beforeEach(() => {
        previousSerializerConfig = BaseSerializer.configManager;
        BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });
    });

    afterEach(() => {
        BaseSerializer.setConfigManager(previousSerializerConfig);
    });

    test('returns the matches write-serialized', async () => {
        const { finder } = buildFinder({ matches: [buildRawPerson()] });

        const resources = await finder.findAsync(buildFindArgs());

        expect(resources).toStrictEqual([FhirResourceWriteSerializer.serialize({ obj: buildRawPerson() })]);
        expect(resources[0]).not.toHaveProperty('_id');
        expect(resources[0]).not.toHaveProperty('notAFhirField');
        expect(resources[0]).toMatchObject({ resourceType: 'Person', _uuid: PERSON_UUID });
    });

    test('returns every match, in the order the database gave them', async () => {
        const otherUuid = '00000000-0000-4000-8000-0000000000a2';
        const { finder } = buildFinder({ matches: [buildRawPerson(), buildRawPerson(otherUuid)] });

        const resources = await finder.findAsync(buildFindArgs());

        expect(resources.map((resource) => resource._uuid)).toStrictEqual([PERSON_UUID, otherUuid]);
    });

    test('no match gives an empty list', async () => {
        const { finder } = buildFinder({ matches: [] });

        const resources = await finder.findAsync(buildFindArgs());

        expect(resources).toStrictEqual([]);
    });

    test.each([
        { accessRequested: 'u', currentOperationName: 'patch', resourceType: 'Patient' },
        { accessRequested: 'r', currentOperationName: 'admin', resourceType: 'Person' }
    ])(
        'builds the query through the search manager with access $accessRequested and names the operation $currentOperationName',
        async ({ accessRequested, currentOperationName, resourceType }) => {
            const { finder, calls } = buildFinder({ matches: [buildRawPerson()] });
            const parsedArgs = { base_version: '4_0_0', id: PERSON_UUID };

            await finder.findAsync(buildFindArgs({
                resourceType,
                parsedArgs,
                accessRequested,
                currentOperationName
            }));

            expect(calls.construct).toStrictEqual([{
                user: 'synthetic-user',
                scope: 'user/*.* access/client.*',
                isUser: false,
                resourceType,
                useAccessIndex: false,
                personIdFromJwtToken: 'synthetic-person',
                parsedArgs,
                operation: WRITE,
                accessRequested
            }]);
            expect(calls.create).toStrictEqual([{ resourceType, base_version: '4_0_0' }]);
            expect(calls.find).toStrictEqual([{ query: QUERY, extraInfo: { currentOperationName } }]);
        }
    );

    test.each([
        { name: 'the config turns it on', configValue: true, queryValue: undefined, expected: true },
        { name: 'the query asks for it with true', configValue: false, queryValue: 'true', expected: true },
        { name: 'the query asks for it with 1', configValue: false, queryValue: '1', expected: true },
        { name: 'neither asks for it', configValue: false, queryValue: undefined, expected: false },
        { name: 'the query turns it off with false', configValue: false, queryValue: 'false', expected: false }
    ])(
        'the query uses the access index when asked: $name',
        async ({ configValue, queryValue, expected }) => {
            const { finder, calls } = buildFinder({ matches: [], useAccessIndex: configValue });
            const parsedArgs = { base_version: '4_0_0', id: PERSON_UUID, _useAccessIndex: queryValue };

            await finder.findAsync(buildFindArgs({ parsedArgs }));

            expect(calls.construct).toHaveLength(1);
            expect(calls.construct[0].useAccessIndex).toBe(expected);
        }
    );

    test.each([
        { name: 'a limit', limit: 2, expectedFind: { query: QUERY, extraInfo: { currentOperationName: 'admin' }, options: { limit: 2 } } },
        { name: 'no limit', limit: undefined, expectedFind: { query: QUERY, extraInfo: { currentOperationName: 'admin' } } }
    ])('passes $name to the database query as given', async ({ limit, expectedFind }) => {
        const { finder, calls } = buildFinder({ matches: [buildRawPerson()] });
        const args = limit === undefined ? buildFindArgs() : buildFindArgs({ limit });

        await finder.findAsync(args);

        expect(calls.find).toStrictEqual([expectedFind]);
    });

    test('lets an error from the search through', async () => {
        const searchError = new Error('synthetic search failure');
        const { finder, calls } = buildFinder({ searchError });

        await expect(finder.findAsync(buildFindArgs())).rejects.toBe(searchError);

        expect(calls.find).toStrictEqual([]);
    });
});
