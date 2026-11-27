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
const { setTimeout: sleep } = require('node:timers/promises');

const ENCOUNTER_UUID = 'c87b8e53-b3db-53a0-aa92-05f4a3fb9d15';

describe('Patient reference tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient reference update', () => {
        test.each([
            ['Id', '1'],
            ['Id and sourceAssigningAuthority', '1|client']
        ])('Reference update using admin for Encounter with %s', async (name, resourceId) => {
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
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '2',
                    resourceType: 'Encounter',
                    resourceId
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: `Patient reference updated for Encounter with id ${resourceId}`,
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
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '2',
                    resourceType: 'Encounter',
                    resourceId: ENCOUNTER_UUID
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: `Patient reference updated for Encounter with id ${ENCOUNTER_UUID}`,
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

        test('Reference update using admin bumps meta.lastUpdated and keeps each version\'s own timestamp in history', async () => {
            const request = await createTestRequest();

            await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounter1Resource)
                .set(getHeaders())
                .expect(200);

            const before = await request.get('/4_0_0/Encounter/1').set(getHeaders()).expect(200);
            await sleep(20);

            await request
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '2',
                    resourceType: 'Encounter',
                    resourceId: ENCOUNTER_UUID
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            const after = await request.get('/4_0_0/Encounter/1').set(getHeaders()).expect(200);
            expect(after.body.meta.versionId).toBe('2');
            expect(Date.parse(after.body.meta.lastUpdated)).toBeGreaterThan(Date.parse(before.body.meta.lastUpdated));

            const version1 = await request.get('/4_0_0/Encounter/1/_history/1').set(getHeaders()).expect(200);
            const version2 = await request.get('/4_0_0/Encounter/1/_history/2').set(getHeaders()).expect(200);
            expect(version1.body.meta.lastUpdated).toBe(before.body.meta.lastUpdated);
            expect(version2.body.meta.lastUpdated).toBe(after.body.meta.lastUpdated);
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
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '1',
                    resourceType: 'Encounter',
                    resourceId: ENCOUNTER_UUID
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: `Couldn't update Patient reference in Encounter with id ${ENCOUNTER_UUID}`,
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
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '2',
                    resourceType: 'Encounter',
                    resourceId: ENCOUNTER_UUID
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(404);

            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'not-found',
                        details: { text: `Resource not found: Encounter/${ENCOUNTER_UUID}` }
                    }
                ]
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
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '2',
                    resourceType: 'Encounter',
                    resourceId: ENCOUNTER_UUID
                })
                .set(getHeadersWithCustomToken('user/*.* access/client1.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: `Patient reference updated for Encounter with id ${ENCOUNTER_UUID}`,
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
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '2',
                    resourceType: 'Encounter',
                    resourceId: ENCOUNTER_UUID
                })
                .set(getHeadersWithCustomToken('user/Task.* access/client1.* admin/*.*'))
                .expect(200);

            expect(resp).toHaveResponse({
                message: `Patient reference updated for Encounter with id ${ENCOUNTER_UUID}`,
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
                .post('/admin/updatePatientReference')
                .send({
                    resourceType: 'Encounter',
                    resourceId: 'c87b8e53-b3db-53a0-aa92-05f4a3fb9d15'
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(400);

            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'invalid',
                        details: {
                            text: 'Missing required parameter(s): patientId'
                        }
                    }
                ]
            });

            resp = await request
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '2',
                    resourceId: 'c87b8e53-b3db-53a0-aa92-05f4a3fb9d15'
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(400);

            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'invalid',
                        details: {
                            text: 'Missing required parameter(s): resourceType'
                        }
                    }
                ]
            });

            resp = await request
                .post('/admin/updatePatientReference')
                .send({
                    resourceType: 'Encounter',
                    patientId: '2'
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(400);

            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'invalid',
                        details: {
                            text: 'Missing required parameter(s): resourceId'
                        }
                    }
                ]
            });
        });

        test('Updating invalid resource doesn\'t work', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '1',
                    resourceType: 'Test',
                    resourceId: '1'
                })
                .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
                .expect(400);

            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'invalid',
                        details: {
                            text: 'ResourceType Test not supported'
                        }
                    }
                ]
            });
        });

        test('Updating invalid resource doesn\'t work without allowed Content Type', async () => {
            const request = await createTestRequest();
            const headers = getHeadersWithCustomToken('user/*.* access/*.* admin/*.*');
            headers['Content-Type'] = 'application/json';
            const resp = await request
                .post('/admin/updatePatientReference')
                .send({
                    patientId: '1',
                    resourceType: 'Test',
                    resourceId: '1'
                })
                .set(headers)
                .expect(400);

            expect(resp).toHaveResponse({
                message: "Content Type application/json is not supported. Allowed content-types are: application/fhir+json,application/json+fhir"
            });
        });
    });
});
