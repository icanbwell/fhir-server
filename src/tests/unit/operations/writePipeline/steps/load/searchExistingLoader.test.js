const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { SearchExistingLoader } = require('../../../../../../operations/writePipeline/steps/load/searchExistingLoader');
const { SearchManager } = require('../../../../../../operations/search/searchManager');
const { DatabaseQueryFactory } = require('../../../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { FhirResourceWriteSerializer } = require('../../../../../../fhir/fhirResourceWriteSerializer');
const BaseSerializer = require('../../../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');
const { SecurityTagSystem } = require('../../../../../../utils/securityTagSystem');
const { OPERATIONS: { WRITE } } = require('../../../../../../constants');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');

/**
 * The `_uuid` of the stored Patient.
 */
const STORED_UUID = '00000000-0000-4000-8000-00000000000a';

/**
 * The caller's request info: a synthetic user that holds the update access scope of one tenant.
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
const QUERY = Object.freeze({ id: 'synthetic-patient', 'meta.security.code': 'client' });

/**
 * Builds a context for a PATCH of `synthetic-patient`, with the given extra parsed args.
 */
const buildContext = (extraArgs = {}) => new WriteContext({
    requestInfo: REQUEST_INFO,
    base_version: '4_0_0',
    parsedArgs: { base_version: '4_0_0', id: 'synthetic-patient', ...extraArgs },
    smartMerge: false
});

/**
 * Builds the stub item a PATCH starts with: the resource type and id from the URL.
 */
const buildItem = (index = 0, id = 'synthetic-patient') => new WriteItem({
    index,
    incoming: { resourceType: 'Patient', id }
});

/**
 * Builds a Patient as the database returns it: with the Mongo `_id` and a field the schema does not
 * know, which the write serialization drops.
 */
const buildRawPatient = ({ authority = 'client', uuid = STORED_UUID, id = 'synthetic-patient' } = {}) => ({
    _id: 'synthetic-mongo-id',
    resourceType: 'Patient',
    id,
    _uuid: uuid,
    _sourceAssigningAuthority: authority,
    meta: {
        versionId: '1',
        security: [
            { system: SecurityTagSystem.access, code: 'client' },
            { system: SecurityTagSystem.sourceAssigningAuthority, code: authority }
        ]
    },
    name: [{ family: 'Synthetic' }],
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
 * Builds the loader with faked boundaries: the search manager returns `QUERY`, and the database
 * returns the next list in `matchesPerCall` for each find. Each call to the boundaries is recorded
 * in `calls`. A `searchError` makes the search manager throw it.
 */
const buildLoader = ({ matchesPerCall = [[]], useAccessIndex = false, searchError = null } = {}) => {
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
                const matches = matchesPerCall[calls.find.length];
                calls.find.push(findArgs);
                return { toArrayAsync: async () => matches };
            }
        };
    };
    const loader = new SearchExistingLoader({
        searchManager,
        databaseQueryFactory,
        configManager: buildConfigManager(useAccessIndex)
    });
    return { loader, calls };
};

describe('SearchExistingLoader', () => {
    let previousSerializerConfig;

    beforeEach(() => {
        previousSerializerConfig = BaseSerializer.configManager;
        BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });
    });

    afterEach(() => {
        BaseSerializer.setConfigManager(previousSerializerConfig);
    });

    test('one match sets stored and copies the identity', async () => {
        const { loader } = buildLoader({ matchesPerCall: [[buildRawPatient({ authority: 'synthetic-client' })]] });
        const item = buildItem();

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(item.failure).toBeNull();
        expect(item.stored).toMatchObject({
            resourceType: 'Patient',
            id: 'synthetic-patient',
            _uuid: STORED_UUID,
            _sourceAssigningAuthority: 'synthetic-client',
            name: [{ family: 'Synthetic' }]
        });
        expect(item.incoming).toStrictEqual({
            resourceType: 'Patient',
            id: 'synthetic-patient',
            _uuid: STORED_UUID,
            _sourceAssigningAuthority: 'synthetic-client'
        });
    });

    test('copies the stored id onto incoming when the URL id is the uuid', async () => {
        const { loader } = buildLoader({ matchesPerCall: [[buildRawPatient({ id: 'synthetic-source-id' })]] });
        const item = buildItem(0, STORED_UUID);

        await loader.loadAsync({
            items: [item],
            context: buildContext({ id: STORED_UUID })
        });

        expect(item.stored.id).toBe('synthetic-source-id');
        expect(item.incoming).toStrictEqual({
            resourceType: 'Patient',
            id: 'synthetic-source-id',
            _uuid: STORED_UUID,
            _sourceAssigningAuthority: 'client'
        });
    });

    test('no match fails at LOOKUP with a 404 error', async () => {
        const { loader } = buildLoader({ matchesPerCall: [[]] });
        const item = buildItem();

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.LOOKUP);
        expect(item.failure.operationOutcome).toBeNull();
        expect(item.failure.error.statusCode).toBe(404);
        expect(item.failure.error.issue[0].code).toBe('not-found');
        expect(item.failure.error.message).toContain('Resource not found: Patient/synthetic-patient');
        expect(item.failure.subject).toStrictEqual({
            id: 'synthetic-patient',
            uuid: undefined,
            sourceAssigningAuthority: undefined,
            resourceType: 'Patient'
        });
        expect(item.stored).toBeNull();
        expect(item.incoming).toStrictEqual({ resourceType: 'Patient', id: 'synthetic-patient' });
    });

    test('several matches fail at LOOKUP with a 400 that lists id|authority options sorted', async () => {
        const withoutMeta = { ...buildRawPatient({ authority: 'unused' }), meta: undefined };
        const { loader } = buildLoader({
            matchesPerCall: [[
                buildRawPatient({ authority: 'zeta', uuid: '00000000-0000-4000-8000-00000000000b' }),
                withoutMeta,
                buildRawPatient({ authority: 'alpha', uuid: '00000000-0000-4000-8000-00000000000c' })
            ]]
        });
        const item = buildItem();

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.LOOKUP);
        expect(item.failure.operationOutcome).toBeNull();
        expect(item.failure.error.statusCode).toBe(400);
        expect(item.failure.error.issue[0].code).toBe('invalid');
        expect(item.failure.error.message).toBe(
            'Multiple resources found with id synthetic-patient.  ' +
            'Please either specify the owner/sourceAssigningAuthority tag: ' +
            'synthetic-patient|alpha or synthetic-patient|zeta' +
            ' OR use uuid to query.'
        );
        expect(item.stored).toBeNull();
        expect(item.incoming).toStrictEqual({ resourceType: 'Patient', id: 'synthetic-patient' });
    });

    test.each([
        { name: 'the config turns it on', configValue: true, queryValue: undefined, expected: true },
        { name: 'the query asks for it with true', configValue: false, queryValue: 'true', expected: true },
        { name: 'the query asks for it with 1', configValue: false, queryValue: '1', expected: true },
        { name: 'neither asks for it', configValue: false, queryValue: undefined, expected: false },
        { name: 'the query turns it off with false', configValue: false, queryValue: 'false', expected: false }
    ])(
        'the query uses the access index when asked: $name',
        async ({ configValue, queryValue, expected }) => {
            const { loader, calls } = buildLoader({
                matchesPerCall: [[buildRawPatient()]],
                useAccessIndex: configValue
            });
            const context = buildContext({ _useAccessIndex: queryValue });

            await loader.loadAsync({ items: [buildItem()], context });

            expect(calls.construct).toStrictEqual([{
                user: 'synthetic-user',
                scope: 'user/*.* access/client.*',
                isUser: false,
                resourceType: 'Patient',
                useAccessIndex: expected,
                personIdFromJwtToken: 'synthetic-person',
                parsedArgs: context.parsedArgs,
                operation: WRITE,
                accessRequested: 'u'
            }]);
            expect(calls.create).toStrictEqual([{ resourceType: 'Patient', base_version: '4_0_0' }]);
            expect(calls.find).toStrictEqual([
                { query: QUERY, extraInfo: { currentOperationName: 'patch' } }
            ]);
        }
    );

    test('the stored doc is write-serialized', async () => {
        const { loader } = buildLoader({ matchesPerCall: [[buildRawPatient()]] });
        const item = buildItem();

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.stored).toStrictEqual(
            FhirResourceWriteSerializer.serialize({ obj: buildRawPatient() })
        );
        expect(item.stored).not.toHaveProperty('_id');
        expect(item.stored).not.toHaveProperty('notAFhirField');
    });

    test('loads each item on its own and fails only the one without a match', async () => {
        const { loader, calls } = buildLoader({ matchesPerCall: [[], [buildRawPatient()]] });
        const items = [buildItem(0), buildItem(1)];

        await loader.loadAsync({ items, context: buildContext() });

        expect(calls.find).toHaveLength(2);
        expect(items.map((item) => item.status)).toStrictEqual([
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.ACTIVE
        ]);
        expect(items[0].stored).toBeNull();
        expect(items[1].stored).toMatchObject({ _uuid: STORED_UUID });
    });

    test('lets an error from the search through without failing the item', async () => {
        const searchError = new Error('synthetic search failure');
        const { loader } = buildLoader({ searchError });
        const item = buildItem();

        await expect(loader.loadAsync({ items: [item], context: buildContext() })).rejects.toBe(searchError);

        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(item.failure).toBeNull();
    });
});
