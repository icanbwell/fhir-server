'use strict';

const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { SimpleContainer } = require('../../../../utils/simpleContainer');

/**
 * src/admin/scripts/createAtlasSearchIndexes.js does not follow the container.register()+Runner
 * pattern used elsewhere in admin/scripts. Instead it builds a `getCollectionAsync` closure
 * in-line and hands it to `createAllAtlasSearchIndexesAsync`. That closure is the real logic
 * worth testing (RULE 10 parameter sensitivity): it must call
 * `resourceLocatorFactory.createResourceLocator({ resourceType, base_version: '4_0_0' })` with
 * whatever resourceType it is invoked with, and return that locator's collection.
 */

const SCRIPT_PATH = '../../../../admin/scripts/createAtlasSearchIndexes';
const HELPER_PATH = '../../../../admin/scripts/atlasSearchIndexHelper';
const CONTAINER_PATH = '../../../../createContainer';

function buildContainer (overrides = {}) {
    const container = new SimpleContainer();
    const mockGetCollectionAsync = jest.fn().mockImplementation(async () => ({ ok: true }));
    const mockCreateResourceLocator = jest.fn().mockImplementation(() => ({
        getCollectionAsync: mockGetCollectionAsync
    }));
    Object.assign(container, {
        resourceLocatorFactory: { createResourceLocator: mockCreateResourceLocator }
    }, overrides);
    return { container, mockCreateResourceLocator, mockGetCollectionAsync };
}

async function flushAsync (times = 15) {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

async function runScript ({ createAllImpl } = {}) {
    jest.resetModules();

    const { container, mockCreateResourceLocator, mockGetCollectionAsync } = buildContainer();
    const mockCreateAll = createAllImpl || jest.fn().mockResolvedValue(undefined);

    jest.doMock(HELPER_PATH, () => ({ createAllAtlasSearchIndexesAsync: mockCreateAll }));
    jest.doMock(CONTAINER_PATH, () => ({ createContainer: jest.fn(() => container) }));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    require(SCRIPT_PATH);
    await flushAsync();

    return { mockCreateAll, mockCreateResourceLocator, mockGetCollectionAsync, exitSpy, errorSpy };
}

describe('admin/scripts/createAtlasSearchIndexes.js', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('calls createAllAtlasSearchIndexesAsync with a getCollectionAsync function and an adminLogger', async () => {
        const { mockCreateAll } = await runScript();
        expect(mockCreateAll).toHaveBeenCalledTimes(1);
        const args = mockCreateAll.mock.calls[0][0];
        expect(typeof args.getCollectionAsync).toBe('function');
        expect(typeof args.adminLogger.logInfo).toBe('function');
    });

    test('getCollectionAsync("Patient") resolves the collection via resourceLocatorFactory with base_version 4_0_0', async () => {
        const { mockCreateAll, mockCreateResourceLocator, mockGetCollectionAsync } = await runScript();
        const { getCollectionAsync } = mockCreateAll.mock.calls[0][0];

        const result = await getCollectionAsync('Patient');

        expect(mockCreateResourceLocator).toHaveBeenCalledWith({ resourceType: 'Patient', base_version: '4_0_0' });
        expect(mockGetCollectionAsync).toHaveBeenCalledWith({});
        expect(result).toEqual({ ok: true });
    });

    test('parameter sensitivity: getCollectionAsync forwards whichever resourceType it is called with', async () => {
        const { mockCreateAll, mockCreateResourceLocator } = await runScript();
        const { getCollectionAsync } = mockCreateAll.mock.calls[0][0];

        await getCollectionAsync('Person');
        await getCollectionAsync('Practitioner');

        expect(mockCreateResourceLocator).toHaveBeenNthCalledWith(1, { resourceType: 'Person', base_version: '4_0_0' });
        expect(mockCreateResourceLocator).toHaveBeenNthCalledWith(2, { resourceType: 'Practitioner', base_version: '4_0_0' });
    });

    test('exits with code 0 after createAllAtlasSearchIndexesAsync resolves', async () => {
        const { exitSpy } = await runScript();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test('exits with code 1 and logs the error when createAllAtlasSearchIndexesAsync rejects', async () => {
        const { exitSpy, errorSpy } = await runScript({
            createAllImpl: jest.fn().mockRejectedValue(new Error('Atlas Search not supported'))
        });
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(exitSpy).not.toHaveBeenCalledWith(0);
        expect(errorSpy).toHaveBeenCalled();
    });
});
