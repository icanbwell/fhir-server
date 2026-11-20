const { describe, test, expect } = require('@jest/globals');
const { AdminTargetLoader } = require('../../../../../../operations/writePipeline/steps/load/adminTargetLoader');
const { AccessFilteredFinder } = require('../../../../../../operations/writePipeline/steps/load/accessFilteredFinder');
const { R4ArgsParser } = require('../../../../../../operations/query/r4ArgsParser');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');

/**
 * The `_uuid` of the target Person and of the linked Patient.
 */
const PERSON_UUID = '00000000-0000-4000-8000-0000000000a1';
const PATIENT_UUID = '00000000-0000-4000-8000-0000000000b1';

/**
 * The caller's request info: a synthetic user.
 */
const REQUEST_INFO = Object.freeze({
    requestId: 'synthetic-request',
    user: 'synthetic-user',
    scope: 'user/*.* access/client.*',
    isUser: false,
    personIdFromJwtToken: 'synthetic-person'
});

/**
 * Builds the context of an admin write.
 */
const buildContext = () => new WriteContext({
    requestInfo: REQUEST_INFO,
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

/**
 * Builds an admin item for a change of the Person, linking the Patient.
 */
const buildItem = ({ index = 0, linkTargetLookup = 'always', createsMissingTarget = false } = {}) => {
    const item = new WriteItem({ index, incoming: { resourceType: 'Person', id: PERSON_UUID } });
    item.adminChange = {
        kind: 'addLink',
        target: { resourceType: 'Person', id: PERSON_UUID },
        linkTarget: { resourceType: 'Patient', id: PATIENT_UUID },
        linkTargetLookup,
        createsMissingTarget
    };
    return item;
};

/**
 * Builds the write-serialized Person the finder returns for the target.
 */
const buildStoredPerson = () => ({
    resourceType: 'Person',
    id: 'synthetic-person-id',
    _uuid: PERSON_UUID,
    _sourceAssigningAuthority: 'synthetic-client',
    link: []
});

/**
 * Builds the write-serialized Patient the finder returns for the link target.
 */
const buildStoredPatient = () => ({
    resourceType: 'Patient',
    id: 'synthetic-patient-id',
    _uuid: PATIENT_UUID,
    _sourceAssigningAuthority: 'synthetic-client'
});

/**
 * Builds the loader with faked collaborators. The parser double returns the arguments it was given,
 * so a test can see which lookup the finder was asked for. The finder double answers each lookup
 * from `matchesByUuid` (an empty list for an id it has no entry for) and records every call in
 * `finds`. A `searchError` makes the finder throw it.
 */
const buildLoader = ({ matchesByUuid = {}, searchError = null } = {}) => {
    const finds = [];
    const r4ArgsParser = Object.create(R4ArgsParser.prototype);
    r4ArgsParser.parseArgs = ({ resourceType, args }) => ({ parsedFor: resourceType, ...args });
    const accessFilteredFinder = Object.create(AccessFilteredFinder.prototype);
    accessFilteredFinder.findAsync = async (args) => {
        finds.push(args);
        if (searchError) {
            throw searchError;
        }
        return matchesByUuid[args.parsedArgs.id] ?? [];
    };
    return { loader: new AdminTargetLoader({ accessFilteredFinder, r4ArgsParser }), finds };
};

describe('AdminTargetLoader', () => {
    test.each([
        {
            name: 'target and link target found',
            options: {},
            matches: { [PERSON_UUID]: [buildStoredPerson()], [PATIENT_UUID]: [buildStoredPatient()] },
            expected: {
                status: WRITE_ITEM_STATUS.ACTIVE,
                stored: true,
                linked: ['Patient'],
                identityCopied: true,
                lookups: ['Person:u', 'Patient:r'],
                failureMessage: null
            }
        },
        {
            name: 'target found, link target not looked up',
            options: { linkTargetLookup: 'never' },
            matches: { [PERSON_UUID]: [buildStoredPerson()], [PATIENT_UUID]: [buildStoredPatient()] },
            expected: {
                status: WRITE_ITEM_STATUS.ACTIVE,
                stored: true,
                linked: [],
                identityCopied: true,
                lookups: ['Person:u'],
                failureMessage: null
            }
        },
        {
            name: 'target not found',
            options: {},
            matches: { [PATIENT_UUID]: [buildStoredPatient()] },
            expected: {
                status: WRITE_ITEM_STATUS.FAILED,
                stored: false,
                linked: [],
                identityCopied: false,
                lookups: ['Person:u'],
                failureMessage: `Resource not found: Person/${PERSON_UUID}`
            }
        },
        {
            name: 'target found, link target not found',
            options: {},
            matches: { [PERSON_UUID]: [buildStoredPerson()] },
            expected: {
                status: WRITE_ITEM_STATUS.FAILED,
                stored: true,
                linked: [],
                identityCopied: true,
                lookups: ['Person:u', 'Patient:r'],
                failureMessage: `Resource not found: Patient/${PATIENT_UUID}`
            }
        },
        {
            name: 'target not found but it is to be created, link target found',
            options: { createsMissingTarget: true, linkTargetLookup: 'whenTargetMissing' },
            matches: { [PATIENT_UUID]: [buildStoredPatient()] },
            expected: {
                status: WRITE_ITEM_STATUS.ACTIVE,
                stored: false,
                linked: ['Patient'],
                identityCopied: false,
                lookups: ['Person:r', 'Patient:r'],
                failureMessage: null
            }
        },
        {
            name: 'target not found but it is to be created, link target not found',
            options: { createsMissingTarget: true, linkTargetLookup: 'whenTargetMissing' },
            matches: {},
            expected: {
                status: WRITE_ITEM_STATUS.FAILED,
                stored: false,
                linked: [],
                identityCopied: false,
                lookups: ['Person:r', 'Patient:r'],
                failureMessage: `Resource not found: Patient/${PATIENT_UUID}`
            }
        },
        {
            name: 'target found by the read lookup though it may be created: the link target is not looked up',
            options: { createsMissingTarget: true, linkTargetLookup: 'whenTargetMissing' },
            matches: { [PERSON_UUID]: [buildStoredPerson()], [PATIENT_UUID]: [buildStoredPatient()] },
            expected: {
                status: WRITE_ITEM_STATUS.ACTIVE,
                stored: true,
                linked: [],
                identityCopied: true,
                lookups: ['Person:r'],
                failureMessage: null
            }
        },
        {
            name: 'target found and the link target is never looked up, even when it does not exist',
            options: { linkTargetLookup: 'never' },
            matches: { [PERSON_UUID]: [buildStoredPerson()] },
            expected: {
                status: WRITE_ITEM_STATUS.ACTIVE,
                stored: true,
                linked: [],
                identityCopied: true,
                lookups: ['Person:u'],
                failureMessage: null
            }
        }
    ])('$name', async ({ options, matches, expected }) => {
        const { loader, finds } = buildLoader({ matchesByUuid: matches });
        const item = buildItem(options);

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.status).toBe(expected.status);
        expect(finds.map((find) => `${find.resourceType}:${find.accessRequested}`)).toStrictEqual(expected.lookups);
        if (expected.stored) {
            expect(item.stored).toStrictEqual(buildStoredPerson());
        } else {
            expect(item.stored).toBeNull();
        }
        expect(item.linked.map((entry) => entry.resourceType)).toStrictEqual(expected.linked);
        if (expected.linked.length > 0) {
            expect(item.linked[0].resource).toStrictEqual(buildStoredPatient());
        }
        expect(item.incoming).toStrictEqual(
            expected.identityCopied
                ? {
                    resourceType: 'Person',
                    id: 'synthetic-person-id',
                    _uuid: PERSON_UUID,
                    _sourceAssigningAuthority: 'synthetic-client'
                }
                : { resourceType: 'Person', id: PERSON_UUID }
        );
        if (expected.failureMessage === null) {
            expect(item.failure).toBeNull();
        } else {
            expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.LOOKUP);
            expect(item.failure.operationOutcome).toBeNull();
            expect(item.failure.error.statusCode).toBe(404);
            expect(item.failure.error.issue[0].code).toBe('not-found');
            expect(item.failure.error.issue[0].details.text).toBe(expected.failureMessage);
            expect(item.failure.error.message).toBe(expected.failureMessage);
        }
    });

    test('asks the finder for the uuid of each resource, with the caller request info, the admin operation name and a limit of 2', async () => {
        const { loader, finds } = buildLoader({
            matchesByUuid: { [PERSON_UUID]: [buildStoredPerson()], [PATIENT_UUID]: [buildStoredPatient()] }
        });
        const context = buildContext();

        await loader.loadAsync({ items: [buildItem()], context });

        expect(finds).toStrictEqual([
            {
                requestInfo: REQUEST_INFO,
                base_version: '4_0_0',
                resourceType: 'Person',
                parsedArgs: { parsedFor: 'Person', base_version: '4_0_0', id: PERSON_UUID },
                accessRequested: 'u',
                currentOperationName: 'admin',
                limit: 2
            },
            {
                requestInfo: REQUEST_INFO,
                base_version: '4_0_0',
                resourceType: 'Patient',
                parsedArgs: { parsedFor: 'Patient', base_version: '4_0_0', id: PATIENT_UUID },
                accessRequested: 'r',
                currentOperationName: 'admin',
                limit: 2
            }
        ]);
    });

    test.each([
        {
            name: 'the target',
            matches: { [PERSON_UUID]: [buildStoredPerson(), buildStoredPerson()] },
            lookups: ['Person:u']
        },
        {
            name: 'the link target',
            matches: {
                [PERSON_UUID]: [buildStoredPerson()],
                [PATIENT_UUID]: [buildStoredPatient(), buildStoredPatient()]
            },
            lookups: ['Person:u', 'Patient:r']
        }
    ])('several matches for the _uuid of $name fail the item at LOOKUP with a plain Error', async ({ matches, lookups }) => {
        const { loader, finds } = buildLoader({ matchesByUuid: matches });
        const item = buildItem();

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.LOOKUP);
        expect(item.failure.error.constructor).toBe(Error);
        expect(item.failure.error.message).toContain('Multiple resources found with _uuid');
        expect(item.linked).toStrictEqual([]);
        expect(finds.map((find) => `${find.resourceType}:${find.accessRequested}`)).toStrictEqual(lookups);
    });

    test.each([
        { name: 'a _uuid', id: PERSON_UUID, lookupId: PERSON_UUID },
        { name: 'a plain id', id: 'synthetic-person-id', lookupId: 'synthetic-person-id' },
        {
            name: 'id|authority',
            id: 'synthetic-person-id|synthetic-client',
            lookupId: generateUUIDv5('synthetic-person-id|synthetic-client')
        },
        { name: 'a _uuid with an authority', id: `${PERSON_UUID}|synthetic-client`, lookupId: PERSON_UUID }
    ])('looks the target up by the search id parameter for $name', async ({ id, lookupId }) => {
        const { loader, finds } = buildLoader({ matchesByUuid: { [lookupId]: [buildStoredPerson()] } });
        const item = buildItem({ linkTargetLookup: 'never' });
        item.adminChange.target = { resourceType: 'Person', id };

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(finds.map((find) => find.parsedArgs.id)).toStrictEqual([lookupId]);
        expect(finds.map((find) => find.limit)).toStrictEqual([2]);
        expect(item.status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        expect(item.stored).toStrictEqual(buildStoredPerson());
        expect(item.adminChange.target).toStrictEqual({ resourceType: 'Person', id });
    });

    test.each([
        {
            name: 'the target',
            configure: (item) => {
                item.adminChange.target = { resourceType: 'Person', id: 'shared-id' };
            },
            matches: { 'shared-id': [buildStoredPerson(), { ...buildStoredPerson(), _uuid: 'other' }] },
            message: 'The id matches more than one Person; pass the _uuid'
        },
        {
            name: 'the link target',
            configure: (item) => {
                item.adminChange.linkTarget = { resourceType: 'Patient', id: 'shared-id' };
            },
            matches: {
                [PERSON_UUID]: [buildStoredPerson()],
                'shared-id': [buildStoredPatient(), { ...buildStoredPatient(), _uuid: 'other' }]
            },
            message: 'The id matches more than one Patient; pass the _uuid'
        }
    ])('several matches for a plain id of $name fail the item with a 400 invalid that asks for the _uuid', async ({ configure, matches, message }) => {
        const { loader } = buildLoader({ matchesByUuid: matches });
        const item = buildItem();
        configure(item);

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.LOOKUP);
        expect(item.failure.error.statusCode).toBe(400);
        expect(item.failure.error.issue[0].code).toBe('invalid');
        expect(item.failure.error.message).toBe(message);
        expect(item.failure.error.message).not.toContain('shared-id');
        expect(item.linked).toStrictEqual([]);
    });

    test('several matches for id|authority are a _uuid lookup, so they fail with a plain Error', async () => {
        const lookupId = generateUUIDv5('synthetic-person-id|synthetic-client');
        const { loader } = buildLoader({
            matchesByUuid: { [lookupId]: [buildStoredPerson(), buildStoredPerson()] }
        });
        const item = buildItem({ linkTargetLookup: 'never' });
        item.adminChange.target = { resourceType: 'Person', id: 'synthetic-person-id|synthetic-client' };

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.failure.error.constructor).toBe(Error);
        expect(item.failure.error.message).toBe(`Multiple resources found with _uuid Person/${lookupId}`);
    });

    test('names a plain id that is not found in the 404', async () => {
        const { loader } = buildLoader();
        const item = buildItem({ linkTargetLookup: 'never' });
        item.adminChange.target = { resourceType: 'Person', id: 'synthetic-missing-id' };

        await loader.loadAsync({ items: [item], context: buildContext() });

        expect(item.failure.error.statusCode).toBe(404);
        expect(item.failure.error.message).toBe('Resource not found: Person/synthetic-missing-id');
    });

    test('loads each item on its own and fails only the one without a target', async () => {
        const otherUuid = '00000000-0000-4000-8000-0000000000a2';
        const { loader, finds } = buildLoader({
            matchesByUuid: { [PERSON_UUID]: [buildStoredPerson()] }
        });
        const failing = buildItem({ index: 0, linkTargetLookup: 'never' });
        failing.adminChange.target = { resourceType: 'Person', id: otherUuid };
        const passing = buildItem({ index: 1, linkTargetLookup: 'never' });

        await loader.loadAsync({ items: [failing, passing], context: buildContext() });

        expect(finds).toHaveLength(2);
        expect([failing.status, passing.status]).toStrictEqual([
            WRITE_ITEM_STATUS.FAILED,
            WRITE_ITEM_STATUS.ACTIVE
        ]);
        expect(failing.stored).toBeNull();
        expect(passing.stored).toStrictEqual(buildStoredPerson());
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
