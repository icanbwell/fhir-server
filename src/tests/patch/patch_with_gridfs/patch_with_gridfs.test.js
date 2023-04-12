const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersJsonPatch
} = require('../../common');

const documentReferenceData = require('./fixtures/document_reference/document_reference1.json');
const patch1 = require('./fixtures/patches/patch1.json');
const patch2 = require('./fixtures/patches/patch2.json');


describe('GridFs Patch Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Document Reference patch Tests', () => {
        test('_file_id stored in db instead of data works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/DocumentReference/1')
                .send(patch1)
                .set(getHeadersJsonPatch())
                .expect(200);

            expect(resp._body.content[0].attachment.data).toBeUndefined();

            expect(resp._body.content[0].attachment._file_id).toBeDefined();
        });

        test('_file_id doesn\'t change when updating other fields works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/DocumentReference/1')
                .send(patch2)
                .set(getHeadersJsonPatch())
                .expect(200);

            expect(resp._body.content[0].attachment.title).toEqual('ADSFXGCVHBJgfxcasdhcvjsdcfasdvc');

            expect(resp._body.content[0].attachment.data).toBeUndefined();

            expect(resp._body.content[0].attachment._file_id).toBeDefined();
        });
    });
});
