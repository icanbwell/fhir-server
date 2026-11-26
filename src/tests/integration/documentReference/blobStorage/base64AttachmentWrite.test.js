'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { commonAfterEach, commonBeforeEach, mockHttpContext } = require('../../common');
const {
    ENV_ON, LARGE_DATA, PATHS, SMALL_DATA, WRITES,
    attachmentOf, buildDocumentReference, createRequestAsync,
    expectExternalized, expectInline, restoreEnv, saveEnv, settle,
    WRITE_MODES, applyWriteMode
} = require('./blobStorageTestSupport');

describe.each(WRITE_MODES)('DocumentReference attachment writes with the Base64DataManager flag on [%s]', (_mode, operations) => {
    let savedEnv;
    let requestId;
    let request;

    beforeEach(async () => {
        savedEnv = saveEnv();
        applyWriteMode(operations);
        await commonBeforeEach();
        requestId = mockHttpContext();
        request = await createRequestAsync(ENV_ON);
    });

    afterEach(async () => {
        await commonAfterEach();
        restoreEnv(savedEnv);
    });

    test.each(PATHS.map((path) => [path.name, path]))(
        '%s above the threshold goes to S3, not GridFS',
        async (_name, path) => {
            const created = await WRITES.post(request, buildDocumentReference({
                place: path.place, attachment: attachmentOf(LARGE_DATA)
            }));
            await settle(requestId);

            await expectExternalized({ request, path, id: created.body.id, data: LARGE_DATA });
        }
    );

    test.each(PATHS.map((path) => [path.name, path]))(
        '%s below the threshold stays inline',
        async (_name, path) => {
            const created = await WRITES.post(request, buildDocumentReference({
                place: path.place, attachment: attachmentOf(SMALL_DATA)
            }));
            await settle(requestId);

            await expectInline({ request, path, id: created.body.id, data: SMALL_DATA });
        }
    );

    // Gate 1 and the Base64DataManager wiring sit on each write operation separately
    test.each(['put', 'merge'])(
        'content attachment above the threshold via %s goes to S3, not GridFS',
        async (write) => {
            const path = PATHS[0];
            const created = await WRITES[write](request, buildDocumentReference({
                id: `write-${write}`, place: path.place, attachment: attachmentOf(LARGE_DATA)
            }));
            await settle(requestId);

            await expectExternalized({ request, path, id: created.body.id, data: LARGE_DATA });
        }
    );

    test.each([
        ['above the threshold', LARGE_DATA],
        ['below the threshold', SMALL_DATA]
    ])('the POST response carries attachment.data (%s)', async (_name, data) => {
        const path = PATHS[0];

        const created = await WRITES.post(request, buildDocumentReference({
            place: path.place, attachment: attachmentOf(data)
        }));
        await settle(requestId);

        expect(path.read(created.body).data).toBe(data);
        expect(path.read(created.body)._blobMeta).toBeUndefined();
    });
});
