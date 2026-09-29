const person1Resource = require('./fixtures/Person/person1.json');

const patchInternalSourceAssigningAuthority = require('./fixtures/patches/patch_internal_source_assigning_authority.json');
const patchInternalUuid = require('./fixtures/patches/patch_internal_uuid.json');
const patchInternalAccess = require('./fixtures/patches/patch_internal_access.json');
const patchNestedReferenceInternal = require('./fixtures/patches/patch_nested_reference_internal.json');
const patchMixedValidAndInternal = require('./fixtures/patches/patch_mixed_valid_and_internal.json');
const patchMoveFromInternal = require('./fixtures/patches/patch_move_from_internal.json');
const patchCopyFromInternal = require('./fixtures/patches/patch_copy_from_internal.json');
const patchMoveToInternal = require('./fixtures/patches/patch_move_to_internal.json');

const expectedErrorSourceAssigningAuthority = require('./fixtures/expected/expected_error_source_assigning_authority.json');
const expectedErrorUuid = require('./fixtures/expected/expected_error_uuid.json');
const expectedErrorAccess = require('./fixtures/expected/expected_error_access.json');
const expectedErrorNestedSourceAssigningAuthority = require('./fixtures/expected/expected_error_nested_source_assigning_authority.json');
const expectedErrorMoveFromInternal = require('./fixtures/expected/expected_error_move_from_internal.json');
const expectedErrorCopyFromInternal = require('./fixtures/expected/expected_error_copy_from_internal.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersJsonPatch,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patch Internal Fields Security Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patch should reject modifications to internal _ fields', () => {
        test('patch rejects modification of top-level _sourceAssigningAuthority', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchInternalSourceAssigningAuthority)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorSourceAssigningAuthority);
        });

        test('patch rejects modification of top-level _uuid', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchInternalUuid)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorUuid);
        });

        test('patch rejects modification of top-level _access', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchInternalAccess)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorAccess);
        });

        test('patch rejects modification of nested reference _sourceAssigningAuthority', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchNestedReferenceInternal)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorNestedSourceAssigningAuthority);
        });

        test('patch rejects entire payload when any operation targets internal fields', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchMixedValidAndInternal)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorNestedSourceAssigningAuthority);

            // Verify none of the changes were applied (including the valid ones)
            resp = await request.get('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890').set(getHeaders());
            expect(resp.body.gender).toBe('male');
            expect(resp.body.active).toBe(true);
        });

        test('patch rejects move from internal field', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchMoveFromInternal)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorMoveFromInternal);
        });

        test('patch rejects copy from internal field', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchCopyFromInternal)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorCopyFromInternal);
        });

        test('patch rejects move to internal field path', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(patchMoveToInternal)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(400);
            expect(resp.body).toStrictEqual(expectedErrorSourceAssigningAuthority);
        });

        test('patch allows legitimate field modifications', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const validPatch = [{ op: 'replace', path: '/gender', value: 'female' }];

            resp = await request
                .patch('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .send(validPatch)
                .set(getHeadersJsonPatch());

            expect(resp.status).toBe(200);

            resp = await request.get('/4_0_0/Person/a1b2c3d4-e5f6-7890-abcd-ef1234567890').set(getHeaders());
            expect(resp.body.gender).toBe('female');
        });
    });
});
