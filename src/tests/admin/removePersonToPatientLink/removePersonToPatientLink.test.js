// test file
const personResource = require('./fixtures/person/person.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expectedPerson.json');
const expectedPersonAfterTest1 = require('./fixtures/expected/personAfterTest1.json');
const expectedPersonAfterTest2 = require('./fixtures/expected/personAfterTest2.json');
const expectedPersonAfterTest3 = require('./fixtures/expected/personAfterTest3.json');
const expectedTest1Result = require('./fixtures/expected/test1Result.json');
const expectedTest2Result = require('./fixtures/expected/test2Result.json');
const expectedTest3Result = require('./fixtures/expected/test3Result.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getHeadersWithCustomToken} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Remove person to patient link test', () => {
        test('person to patient link is removed using id', async () => {
            const request = await createTestRequest();
            // add the person resource to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge?validate=true')
                .send(personResource)
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
                .expect(200);

            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(`/4_0_0/Person/${personResource.id}`)
                .set(getHeaders())
                .expect(200);

            // The link is removed from the person resource.
            expect(resp).toHaveResponse(expectedPersonResources);

            // Remove person to person link using admin panel
            resp = await request
                .get('/admin/removePersonToPatientLink?personId=Person/1&patientId=Patient/1')
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
                .expect(200);

            // Expect removed meesage to be returned
            expect(resp).toHaveResponse(expectedTest1Result);

            resp = await request
                .get(`/4_0_0/Person/${personResource.id}`)
                .set(getHeaders())
                .expect(200);

            // The link is removed from the person resource.
            expect(resp).toHaveResponse(expectedPersonAfterTest1);

            // Expect the history collection to be created
            resp = await request
                .get(`/4_0_0/Person/${personResource.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            // The history collection is created.
            expect(resp).toHaveResponse(expectedPersonAfterTest1);
        });

        test('person to patient link is removed using id and sourceAssigningAuthority', async () => {
            const request = await createTestRequest();
            // add the person resource to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge?validate=true')
                .send(personResource)
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
                .expect(200);

            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(`/4_0_0/Person/${personResource.id}`)
                .set(getHeaders())
                .expect(200);

            // The link is removed from the person resource.
            expect(resp).toHaveResponse(expectedPersonResources);

            // Remove person to person link using admin panel
            resp = await request
                .get('/admin/removePersonToPatientLink?personId=Person/1&patientId=Patient/1|test')
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
                .expect(200);

            // Expect removed meesage to be returned
            expect(resp).toHaveResponse(expectedTest2Result);

            resp = await request
                .get(`/4_0_0/Person/${personResource.id}`)
                .set(getHeaders())
                .expect(200);

            // The link is removed from the person resource.
            expect(resp).toHaveResponse(expectedPersonAfterTest2);

            // Expect the history collection to be created
            resp = await request
                .get(`/4_0_0/Person/${personResource.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            // The history collection is created.
            expect(resp).toHaveResponse(expectedPersonAfterTest2);
        });

        test('person to patient link is removed using uuid', async () => {
            const request = await createTestRequest();
            // add the person resource to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge?validate=true')
                .send(personResource)
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
                .expect(200);

            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(`/4_0_0/Person/${personResource.id}`)
                .set(getHeaders())
                .expect(200);

            // The link is removed from the person resource.
            expect(resp).toHaveResponse(expectedPersonResources);

            // Remove person to person link using admin panel
            resp = await request
                .get('/admin/removePersonToPatientLink?personId=Person/1&patientId=Patient/0bf61676-9672-50e0-ae12-347ecddca84f')
                .set(getHeadersWithCustomToken('user/*.read user/*.write admin/*.*'))
                .expect(200);

            // Expect removed meesage to be returned
            expect(resp).toHaveResponse(expectedTest3Result);

            resp = await request
                .get(`/4_0_0/Person/${personResource.id}`)
                .set(getHeaders())
                .expect(200);

            // The link is removed from the person resource.
            expect(resp).toHaveResponse(expectedPersonAfterTest3);

            // Expect the history collection to be created
            resp = await request
                .get(`/4_0_0/Person/${personResource.id}/_history/2`)
                .set(getHeaders())
                .expect(200);

            // The history collection is created.
            expect(resp).toHaveResponse(expectedPersonAfterTest3);
        });
    });
});
