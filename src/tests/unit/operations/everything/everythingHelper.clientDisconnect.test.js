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
jest.mock('../../../../utils/metrics', () => ({ recordOutboundEverything: jest.fn(), recordEverythingClientDisconnect: jest.fn() }));
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

describe('BaseResponseStreamer.isClientGone on a real HTTP connection', () => {
    test('is true after the client aborts mid-response and false while it is connected', async () => {
        const http = require('http');
        let streamer;
        let resolveAborted;
        const aborted = new Promise((resolve) => { resolveAborted = resolve; });
        const server = http.createServer((req, res) => {
            streamer = createStreamer(res);
            res.write('{"first":true}\n');
            res.on('close', () => resolveAborted());
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const request = http.get({ host: '127.0.0.1', port: server.address().port });
            const firstChunk = await new Promise((resolve, reject) => {
                request.on('response', (response) => response.once('data', resolve));
                request.on('error', reject);
            });
            expect(firstChunk).toBeDefined();
            expect(streamer.isClientGone()).toBe(false);
            request.on('error', () => {});
            request.destroy();
            await aborted;
            expect(streamer.isClientGone()).toBe(true);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
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
        jest.clearAllMocks();
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

    test('markHandled prevents an unhandledRejection but still rejects for the awaiting caller', async () => {
        const { markHandled } = require('../../../../operations/everything/everythingHelper');
        const unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const pending = markHandled(Promise.reject(new ClientDisconnectedError()));
            await new Promise((resolve) => setImmediate(resolve));
            expect(unhandled).not.toHaveBeenCalled();
            await expect(pending).rejects.toBeInstanceOf(ClientDisconnectedError);
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    test.each([
        ['a real failure is logged once even if the caller never awaits it', new Error('mongo failure'), 1],
        ['a disconnect is not logged', new ClientDisconnectedError(), 0]
    ])('markHandled: %s', async (_name, error, expectedWarnings) => {
        const logging = require('../../../../operations/common/logging');
        const { markHandled } = require('../../../../operations/everything/everythingHelper');
        const pending = markHandled(Promise.reject(error));
        await new Promise((resolve) => setImmediate(resolve));
        expect(logging.logWarn).toHaveBeenCalledTimes(expectedWarnings);
        await expect(pending).rejects.toBe(error);
    });

    test('retriveEverythingAsync rethrows ClientDisconnectedError unwrapped; with nothing streamed it writes no audit, only a log and a metric', async () => {
        const logging = require('../../../../operations/common/logging');
        const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
        everythingHelper.supportedResources = ['Patient'];
        everythingHelper._logAuditForRequestAsync = jest.fn();
        everythingHelper.redisStreamManager = { deleteStream: jest.fn() };
        const streamer = createStreamer({ destroyed: true, writableFinished: false });

        await expect(everythingHelper.retriveEverythingAsync({
            requestInfo: { userType: undefined },
            base_version: '4_0_0',
            resourceType: 'Patient',
            parsedArgs: Object.assign(Object.create(ParsedArgs.prototype), {
                get: () => { throw new ClientDisconnectedError(); }
            }),
            responseStreamer: streamer
        })).rejects.toBeInstanceOf(ClientDisconnectedError);

        expect(everythingHelper._logAuditForRequestAsync).not.toHaveBeenCalled();
        expect(require('../../../../utils/metrics').recordEverythingClientDisconnect).toHaveBeenCalledWith('Patient');
        expect(logging.logInfo).toHaveBeenCalledWith(
            '$everything stopped: client disconnected',
            expect.objectContaining({ resourceType: 'Patient', streamedResourceCount: 0 })
        );
        expect(logging.logError).not.toHaveBeenCalled();
    });

    describe('assertClientConnectedAfterSettlingAsync', () => {
        test('does nothing while the client is connected', async () => {
            const streamer = createStreamer({ destroyed: false, writableFinished: false });
            await expect(everythingHelper.assertClientConnectedAfterSettlingAsync({
                responseStreamer: streamer, pending: []
            })).resolves.toBeUndefined();
        });

        test('waits for already-started fetches to settle before throwing', async () => {
            const streamer = createStreamer({ destroyed: true, writableFinished: false });
            const events = [];
            const slow = new Promise((resolve) => setTimeout(() => {
                events.push('fetch settled');
                resolve();
            }, 20));
            const failing = Promise.reject(new ClientDisconnectedError());

            await expect(everythingHelper.assertClientConnectedAfterSettlingAsync({
                responseStreamer: streamer, pending: [slow, failing]
            }).catch((e) => {
                events.push('thrown');
                throw e;
            })).rejects.toBeInstanceOf(ClientDisconnectedError);

            expect(events).toEqual(['fetch settled', 'thrown']);
        });

        test('settles pending fetches and throws the disconnect error even if one failed', async () => {
            const streamer = createStreamer({ destroyed: true, writableFinished: false });
            await expect(everythingHelper.assertClientConnectedAfterSettlingAsync({
                responseStreamer: streamer,
                pending: [Promise.reject(new Error('mongo failure')), Promise.reject(new ClientDisconnectedError())]
            })).rejects.toBeInstanceOf(ClientDisconnectedError);
        });
    });

    describe('disconnect cleanup of a partially written cache entry', () => {
        function setup ({ deleteStream }) {
            const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
            everythingHelper.supportedResources = ['Patient'];
            everythingHelper.configManager = {
                everythingBatchSize: 10,
                writeToCacheForEverythingOperation: true,
                readFromCacheForEverythingOperation: false,
                everythingCacheTtlSeconds: 60
            };
            everythingHelper.getCacheKey = jest.fn(async () => 'cache-key');
            everythingHelper.redisStreamManager = { deleteStream, hasCachedStream: jest.fn(async () => false) };
            everythingHelper.enrichmentManager = {};
            const order = [];
            everythingHelper._logAuditForRequestAsync = jest.fn(() => order.push('audit'));
            deleteStream.mockImplementation(async () => {
                order.push('delete');
            });
            everythingHelper.retrieveEverythingMulipleIdsAsync = jest.fn(async ({ cachedStreamer, streamedResources }) => {
                cachedStreamer.isFirstEntry = false;
                streamedResources.push({ _uuid: 'uuid-1', resourceType: 'Observation' });
                throw new ClientDisconnectedError();
            });
            const parsedArgs = Object.assign(Object.create(ParsedArgs.prototype), {
                get: (name) => (name === 'id' ? { queryParameterValue: { values: ['p1'] } } : undefined),
                clone: () => ({})
            });
            return { parsedArgs, order };
        }

        const run = (parsedArgs) => everythingHelper.retriveEverythingAsync({
            requestInfo: { userType: undefined, skipCachedData: () => false },
            base_version: '4_0_0',
            resourceType: 'Patient',
            parsedArgs,
            // connected at entry so the loop reaches the (stubbed) fetch that reports the disconnect
            responseStreamer: createStreamer({ destroyed: false, writableFinished: false })
        });

        test('audits what was streamed (plain read, no outcome), then deletes the partial cache stream, and rethrows unwrapped', async () => {
            const deleteStream = jest.fn();
            const { parsedArgs, order } = setup({ deleteStream });
            await expect(run(parsedArgs)).rejects.toBeInstanceOf(ClientDisconnectedError);
            const auditArgs = everythingHelper._logAuditForRequestAsync.mock.calls[0][0];
            expect(auditArgs.resourcesToAudit).toEqual([{ _uuid: 'uuid-1', resourceType: 'Observation' }]);
            expect(auditArgs.outcome).toBeUndefined();
            expect(deleteStream).toHaveBeenCalledWith('cache-key');
            expect(order).toEqual(['audit', 'delete']);
        });
    });

    test('retrieveEverythingMulipleIdsAsync rethrows ClientDisconnectedError unwrapped', async () => {
        const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
        const logging = require('../../../../operations/common/logging');
        everythingHelper.supportedResources = ['Patient'];
        await expect(everythingHelper.retrieveEverythingMulipleIdsAsync({
            base_version: '4_0_0',
            requestInfo: { userType: undefined },
            resourceType: 'Patient',
            parsedArgs: Object.defineProperty(Object.create(ParsedArgs.prototype), 'resourceFilterList', {
                get () { throw new ClientDisconnectedError(); }
            }),
            responseStreamer: createStreamer({ destroyed: true, writableFinished: false }),
            streamedResources: []
        })).rejects.toBeInstanceOf(ClientDisconnectedError);
        expect(logging.logError).not.toHaveBeenCalled();
    });

    describe('settleAllOrThrow', () => {
        test('prefers a real failure over a disconnect rejection', async () => {
            const { settleAllOrThrow } = require('../../../../operations/everything/everythingHelper');
            const real = new Error('mongo failure');
            await expect(settleAllOrThrow([
                Promise.reject(new ClientDisconnectedError()),
                Promise.reject(real),
                Promise.reject(new Error('second failure'))
            ])).rejects.toBe(real);
        });

        test('throws the disconnect error when it is the only rejection', async () => {
            const { settleAllOrThrow } = require('../../../../operations/everything/everythingHelper');
            await expect(settleAllOrThrow([Promise.resolve(1), Promise.reject(new ClientDisconnectedError())]))
                .rejects.toBeInstanceOf(ClientDisconnectedError);
        });
    });
});
