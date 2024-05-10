// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person1UpdatedWithId = require('./fixtures/Person/updatedPerson1WithId.json');
const person1UpdatedWithUuid = require('./fixtures/Person/updatedPerson1WithUuid.json');
const person1UpdatedWithSourceAssigningAuthority = require('./fixtures/Person/updatedPerson1WithSourceAssigningAuthority.json');
const person1UpdatedWithOwnerTag = require('./fixtures/Person/updatedPerson1WithOwnerTag.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person2WithInvalidLink = require('./fixtures/Person/person2WithInvalidLink.json');
const procedure1Resource = require('./fixtures/Procedure/procedure1.json');
const procedure1WithoutRequiredFields = require('./fixtures/Procedure/procedure1WithoutRequiredFields.json');

// expected
const expectedPerson1BeforeUpdate = require('./fixtures/expected/expectedPerson1BeforeUpdate.json');
const expectedPerson1AfterUpdate = require('./fixtures/expected/expectedPerson1AfterUpdate.json');
const expectedPerson1AfterReferenceUpdate = require('./fixtures/expected/expectedPerson1AfterReferenceUpdate.json');
const expectedResponseOnError = require('./fixtures/expected/responseOnError.json');
const expectedResponseOnUpdate = require('./fixtures/expected/responseOnUpdate.json');
const expectedPerson2Response = require('./fixtures/expected/expectedPerson2Response.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person update Tests', () => {
        test('Person update with id doesn\'t work', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1UpdatedWithId)
                .set(getHeaders())
                .expect(200);

            expect(resp.body).toEqual(expectedResponseOnError);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            delete resp.body.meta.lastUpdated;
            expect(resp.body).toEqual(expectedPerson1BeforeUpdate);
        });

        test('Person update with uuid works', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1UpdatedWithUuid)
                .set(getHeaders())
                .expect(200);

            expect(resp.body).toEqual(expectedResponseOnUpdate);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            delete resp.body.meta.lastUpdated;
            expect(resp.body).toEqual(expectedPerson1AfterUpdate);
        });

        test('Person update with sourceAssigningAuthority works', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1UpdatedWithSourceAssigningAuthority)
                .set(getHeaders())
                .expect(200);

            expect(resp.body).toEqual(expectedResponseOnUpdate);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            delete resp.body.meta.lastUpdated;
            expect(resp.body).toEqual(expectedPerson1AfterUpdate);
        });

        test('Person update with owner tag works', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1UpdatedWithOwnerTag)
                .set(getHeaders())
                .expect(200);

            expect(resp.body).toEqual(expectedResponseOnUpdate);

            resp = await request
                .get('/4_0_0/Person/1')
                .set(getHeaders())
                .expect(200);

            delete resp.body.meta.lastUpdated;
            expect(resp.body).toEqual(expectedPerson1AfterReferenceUpdate);
        });

        test('Person update without required fields doesn\'t work', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2WithInvalidLink)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson2Response);
        });

        test('Person create without required fields doesn\'t work', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2WithInvalidLink)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson2Response);
        });

        test('Procedure update without required fields work', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Procedure/$merge')
                .send(procedure1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Procedure/$merge')
                .send(procedure1WithoutRequiredFields)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: true });
        });
    });
});
