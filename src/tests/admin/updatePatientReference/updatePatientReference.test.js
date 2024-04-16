// provider file
const encounter1Resource = require('./fixtures/encounter/encounter1.json');

// expected
const expectedEncounterBeforeUpdate = require('./fixtures/expected/expectedEncounterBeforeUpdate.json');
const expectedEncounterAfterUpdate = require('./fixtures/expected/expectedEncounterAfterUpdate.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomToken
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient reference tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient reference update', () => {
        test('Reference update using admin for Encounter with Id', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterBeforeUpdate);

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceType=Encounter&resourceId=1')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'Patient reference updated for Encounter with id 1',
                patientId: '2'
            });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);

            resp = await request
                .get('/4_0_0/Encounter/1/_history/2')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);
        });

        test('Reference update using admin for Encounter with Id and sourceAssigningAuthority', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterBeforeUpdate);

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceType=Encounter&resourceId=1|client')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'Patient reference updated for Encounter with id c87b8e53-b3db-53a0-aa92-05f4a3fb9d15',
                patientId: '2'
            });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);

            resp = await request
                .get('/4_0_0/Encounter/1/_history/2')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);
        });

        test('Reference update using admin for Encounter with Uuid', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterBeforeUpdate);

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceType=Encounter&resourceId=c87b8e53-b3db-53a0-aa92-05f4a3fb9d15')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'Patient reference updated for Encounter with id c87b8e53-b3db-53a0-aa92-05f4a3fb9d15',
                patientId: '2'
            });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);

            resp = await request
                .get('/4_0_0/Encounter/1/_history/2')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);
        });

        test('Reference update with same reference doesn\'t work', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterBeforeUpdate);

            resp = await request
                .get('/admin/updatePatientReference?patientId=1&resourceType=Encounter&resourceId=1')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'Couldn\'t update Patient reference in Encounter with id 1',
                patientId: '1'
            });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterBeforeUpdate);

            resp = await request
                .get('/4_0_0/Encounter/1/_history/2')
                .set(getHeaders())
                .expect(404);
        });

        test('Updating reference on resource which does not exists', async () => {
            const request = await createTestRequest();

            let resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(404);

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceType=Encounter&resourceId=c87b8e53-b3db-53a0-aa92-05f4a3fb9d15')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'Encounter with id c87b8e53-b3db-53a0-aa92-05f4a3fb9d15 does not exist'
            });
        });

        test('Updating reference on resource whose access is not allowed with access scopes works with admin scopes', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterBeforeUpdate);

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceType=Encounter&resourceId=1')
                .set(getHeadersWithCustomToken('user/*.* access/client1.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'Patient reference updated for Encounter with id 1',
                patientId: '2'
            });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);

            resp = await request
                .get('/4_0_0/Encounter/1/_history/2')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);
        });

        test('Updating reference on resource whose access is not allowed with user scopes works with admin scopes', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterBeforeUpdate);

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceType=Encounter&resourceId=1')
                .set(getHeadersWithCustomToken('user/Task.* access/client1.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'Patient reference updated for Encounter with id 1',
                patientId: '2'
            });

            resp = await request
                .get('/4_0_0/Encounter/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);

            resp = await request
                .get('/4_0_0/Encounter/1/_history/2')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedEncounterAfterUpdate);
        });

        test('Updating reference without required fields doesn\'t work', async () => {
            const request = await createTestRequest();

            let resp = await request
                .get('/admin/updatePatientReference?resourceType=Encounter&resourceId=c87b8e53-b3db-53a0-aa92-05f4a3fb9d15')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'No resourceId: c87b8e53-b3db-53a0-aa92-05f4a3fb9d15 or resourceType: Encounter or patientId: undefined passed'
            });

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceId=c87b8e53-b3db-53a0-aa92-05f4a3fb9d15')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'No resourceId: c87b8e53-b3db-53a0-aa92-05f4a3fb9d15 or resourceType: undefined or patientId: 2 passed'
            });

            resp = await request
                .get('/admin/updatePatientReference?patientId=2&resourceType=Encounter')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'No resourceId: undefined or resourceType: Encounter or patientId: 2 passed'
            });
        });

        test('Updating invalid resource doesn\'t work', async () => {
            const request = await createTestRequest();

            const resp = await request
                .get('/admin/updatePatientReference?patientId=1&resourceType=Test&resourceId=1')
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: 'ResourceType Test not supported'
            });
        });
    });
});
