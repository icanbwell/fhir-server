'use strict';
const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

/**
 * atlasSearchIndexHelper.js is a real module (not a self-executing CLI script): it exports
 * readIndexDefinition, waitForSearchIndexReadyAsync, createOrUpdateSearchIndexAsync and
 * createAllAtlasSearchIndexesAsync, all with genuine branching (a polling loop with a timeout, a
 * FAILED-status error path, a drop-and-recreate-if-exists branch, and a loop over RESOURCE_TYPES).
 * It is tested directly by importing the real module and mocking only the Mongo collection/fs
 * boundary -- no CLI/container mocking needed here.
 */

const {
    RESOURCE_TYPES,
    readIndexDefinition,
    waitForSearchIndexReadyAsync,
    createOrUpdateSearchIndexAsync,
    createAllAtlasSearchIndexesAsync
} = require('../../../../admin/scripts/atlasSearchIndexHelper');

function buildAdminLogger () {
    return { logInfo: jestGlobal.fn() };
}

/**
 * Builds a fake Mongo collection whose listSearchIndexes().toArray() resolves in sequence to each
 * entry of `statusSequence` (repeating the last entry once exhausted), so tests can simulate a
 * PENDING -> BUILDING -> READY progression across polling iterations.
 */
function buildFakeCollection ({ statusSequence, collectionName = 'Patient_4_0_0' }) {
    let callIndex = 0;
    return {
        collectionName,
        listSearchIndexes: jestGlobal.fn().mockImplementation(() => ({
            toArray: jestGlobal.fn().mockImplementation(() => {
                const entry = statusSequence[Math.min(callIndex, statusSequence.length - 1)];
                callIndex++;
                return Promise.resolve(entry);
            })
        })),
        dropSearchIndex: jestGlobal.fn().mockResolvedValue(undefined),
        createSearchIndex: jestGlobal.fn().mockResolvedValue(undefined)
    };
}

describe('atlasSearchIndexHelper.js', () => {
    let setTimeoutSpy;

    beforeEach(() => {
        // Collapse the real 2s poll interval so tests run instantly.
        setTimeoutSpy = jestGlobal.spyOn(global, 'setTimeout').mockImplementation((fn) => {
            fn();
            return 0;
        });
    });

    afterEach(() => {
        setTimeoutSpy.mockRestore();
    });

    test('RESOURCE_TYPES lists exactly Patient, Person and Practitioner', () => {
        expect(RESOURCE_TYPES).toEqual(['Patient', 'Person', 'Practitioner']);
    });

    test('readIndexDefinition loads the lower-cased JSON definition file for a resource type', () => {
        const definition = readIndexDefinition('Patient');
        expect(definition).toBeTruthy();
        expect(typeof definition).toBe('object');
    });

    test('readIndexDefinition throws for an unknown resource type (no definition file)', () => {
        expect(() => readIndexDefinition('NotARealResourceType')).toThrow();
    });

    test('waitForSearchIndexReadyAsync resolves immediately when the index is already READY', async () => {
        const collection = buildFakeCollection({ statusSequence: [[{ status: 'READY' }]] });
        const adminLogger = buildAdminLogger();
        await expect(
            waitForSearchIndexReadyAsync({ collection, adminLogger })
        ).resolves.toBeUndefined();
        expect(adminLogger.logInfo).not.toHaveBeenCalled();
    });

    test('waitForSearchIndexReadyAsync polls (logging progress) while PENDING/BUILDING, then resolves on READY', async () => {
        const collection = buildFakeCollection({
            statusSequence: [
                [{ status: 'PENDING' }],
                [{ status: 'BUILDING' }],
                [{ status: 'READY' }]
            ]
        });
        const adminLogger = buildAdminLogger();
        await waitForSearchIndexReadyAsync({ collection, adminLogger });
        expect(adminLogger.logInfo).toHaveBeenCalledTimes(2);
        expect(collection.listSearchIndexes).toHaveBeenCalledTimes(3);
    });

    test('waitForSearchIndexReadyAsync throws when the index reports FAILED', async () => {
        const collection = buildFakeCollection({
            statusSequence: [[{ status: 'FAILED', statusDetail: 'bad definition' }]]
        });
        const adminLogger = buildAdminLogger();
        await expect(
            waitForSearchIndexReadyAsync({ collection, adminLogger })
        ).rejects.toThrow(/failed to build/);
    });

    test('waitForSearchIndexReadyAsync times out and throws if the index never reaches READY', async () => {
        // Every call reports PENDING; force Date.now() to jump past the poll deadline after the
        // first check so the while-loop condition trips without looping thousands of times.
        const realDateNow = Date.now;
        let calls = 0;
        jestGlobal.spyOn(Date, 'now').mockImplementation(() => {
            calls++;
            // First call establishes the deadline baseline; subsequent calls jump far into the future.
            return calls === 1 ? realDateNow() : realDateNow() + 120000;
        });
        try {
            const collection = buildFakeCollection({ statusSequence: [[{ status: 'PENDING' }]] });
            const adminLogger = buildAdminLogger();
            await expect(
                waitForSearchIndexReadyAsync({ collection, adminLogger })
            ).rejects.toThrow(/Timed out/);
        } finally {
            Date.now.mockRestore();
        }
    });

    test('createOrUpdateSearchIndexAsync creates a fresh index when none exists yet (no drop)', async () => {
        const collection = buildFakeCollection({ statusSequence: [[], [{ status: 'READY' }]] });
        const adminLogger = buildAdminLogger();
        await createOrUpdateSearchIndexAsync({ collection, resourceType: 'Patient', adminLogger });
        expect(collection.dropSearchIndex).not.toHaveBeenCalled();
        expect(collection.createSearchIndex).toHaveBeenCalledTimes(1);
        const callArg = collection.createSearchIndex.mock.calls[0][0];
        expect(callArg.name).toBeTruthy();
        expect(callArg.definition).toBeTruthy();
    });

    test('createOrUpdateSearchIndexAsync drops and recreates when an index with that name already exists', async () => {
        const collection = buildFakeCollection({
            statusSequence: [[{ status: 'READY' }], [{ status: 'READY' }]]
        });
        const adminLogger = buildAdminLogger();
        await createOrUpdateSearchIndexAsync({ collection, resourceType: 'Person', adminLogger });
        expect(collection.dropSearchIndex).toHaveBeenCalledTimes(1);
        expect(collection.createSearchIndex).toHaveBeenCalledTimes(1);
    });

    test('createAllAtlasSearchIndexesAsync iterates over all RESOURCE_TYPES, resolving a real collection for each', async () => {
        const resolvedFor = [];
        const getCollectionAsync = jestGlobal.fn().mockImplementation(async (resourceType) => {
            resolvedFor.push(resourceType);
            return buildFakeCollection({ statusSequence: [[{ status: 'READY' }]], collectionName: `${resourceType}_4_0_0` });
        });
        const adminLogger = buildAdminLogger();
        await createAllAtlasSearchIndexesAsync({ getCollectionAsync, adminLogger });
        expect(resolvedFor).toEqual(RESOURCE_TYPES);
        expect(getCollectionAsync).toHaveBeenCalledTimes(RESOURCE_TYPES.length);
    });

    test('createAllAtlasSearchIndexesAsync stops at the first resource type whose index build fails', async () => {
        let call = 0;
        const getCollectionAsync = jestGlobal.fn().mockImplementation(async () => {
            call++;
            // Second resource type's index reports FAILED
            const status = call === 2 ? 'FAILED' : 'READY';
            return buildFakeCollection({ statusSequence: [[{ status }]] });
        });
        const adminLogger = buildAdminLogger();
        await expect(
            createAllAtlasSearchIndexesAsync({ getCollectionAsync, adminLogger })
        ).rejects.toThrow(/failed to build/);
        // Third resource type is never attempted because the loop aborts on the second's failure.
        expect(getCollectionAsync).toHaveBeenCalledTimes(2);
    });
});
