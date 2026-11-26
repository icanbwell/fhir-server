'use strict';

/**
 * $everything stops and closes its cursors when the client disconnects.
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

const { BaseResponseStreamer } = require('../../../../utils/baseResponseStreamer');
const { ClientDisconnectedError } = require('../../../../utils/clientDisconnectedError');
const { ResourceProccessedTracker } = require('../../../../fhir/resourceProcessedTracker');

function createCursor (docs) {
    let index = 0;
    return {
        hasNext: jest.fn(async () => index < docs.length),
        next: jest.fn(async () => docs[index++]),
        close: jest.fn(async () => undefined)
    };
}

function createStreamer (response) {
    return new BaseResponseStreamer({ response, requestId: 'req-1' });
}

describe('BaseResponseStreamer.isClientGone', () => {
    test.each([
        ['connection alive', { destroyed: false, writableFinished: false }, false],
        ['response finished normally', { destroyed: true, writableFinished: true }, false],
        ['client dropped mid-response', { destroyed: true, writableFinished: false }, true]
    ])('%s', (_name, response, expected) => {
        expect(createStreamer(response).isClientGone()).toBe(expected);
    });
});

describe('EverythingHelper client disconnect', () => {
    let everythingHelper;

    function cursorArgs (cursor, responseStreamer) {
        return {
            cursor,
            requestInfo: { userType: undefined, actor: undefined },
            responseStreamer,
            parentParsedArgs: { base_version: '4_0_0', _since: undefined },
            bundleEntryIdsProcessedTracker: new ResourceProccessedTracker(),
            resourceIdentifiers: null,
            nonClinicalReferencesExtractor: null,
            everythingRelatedResourceManager: { allowedToBeSent: () => true },
            useUuidProjection: false,
            streamedResources: []
        };
    }

    beforeEach(() => {
        const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');
        everythingHelper = Object.create(EverythingHelper.prototype);
        everythingHelper.configManager = {};
        everythingHelper.databaseAttachmentManager = {
            transformAttachments: jest.fn(async (r) => r)
        };
        everythingHelper.base64DataManager = { transformAsync: jest.fn(async (r) => r) };
        everythingHelper.enrichmentManager = {
            enrichBundleEntriesAsync: jest.fn(async ({ entries }) => entries)
        };
    });

    test('stops reading and closes the cursor when the client is already gone', async () => {
        const cursor = createCursor([{ resourceType: 'Patient', _uuid: 'p-1' }]);
        const streamer = createStreamer({ destroyed: true, writableFinished: false });

        await expect(
            everythingHelper.processCursorAsync(cursorArgs(cursor, streamer))
        ).rejects.toBeInstanceOf(ClientDisconnectedError);

        expect(cursor.next).not.toHaveBeenCalled();
        expect(cursor.close).toHaveBeenCalledTimes(1);
    });

    test('stops mid-stream when the client disconnects after the first resource', async () => {
        const response = { destroyed: false, writableFinished: false };
        const cursor = createCursor([
            { resourceType: 'Patient', _uuid: 'p-1', _sourceId: 'p-1', _sourceAssigningAuthority: 'a' },
            { resourceType: 'Patient', _uuid: 'p-2', _sourceId: 'p-2', _sourceAssigningAuthority: 'a' }
        ]);
        const streamer = createStreamer(response);
        streamer.writeBundleEntryAsync = jest.fn(async () => {
            response.destroyed = true;
        });

        await expect(
            everythingHelper.processCursorAsync(cursorArgs(cursor, streamer))
        ).rejects.toBeInstanceOf(ClientDisconnectedError);

        expect(cursor.next).toHaveBeenCalledTimes(1);
        expect(cursor.close).toHaveBeenCalledTimes(1);
    });

    test('closes the cursor after normal exhaustion too', async () => {
        const cursor = createCursor([]);

        await everythingHelper.processCursorAsync(cursorArgs(cursor, undefined));

        expect(cursor.close).toHaveBeenCalledTimes(1);
    });

    test('a failing cursor.close does not mask the result', async () => {
        const cursor = createCursor([]);
        cursor.close.mockRejectedValue(new Error('close failed'));

        await expect(
            everythingHelper.processCursorAsync(cursorArgs(cursor, undefined))
        ).resolves.toEqual({ bundleEntries: [], streamedResources: [] });
    });

    test('assertClientConnected is a no-op without a streamer', () => {
        expect(() => everythingHelper.assertClientConnected({ responseStreamer: undefined })).not.toThrow();
    });
});
