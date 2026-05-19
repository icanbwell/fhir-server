const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { Collection, ReadPreference } = require('mongodb');

describe('Write Operations ReadPreference Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Update uses ReadPreference.PRIMARY', () => {
        test('PUT operation reads existing resource from primary', async () => {
            const request = await createTestRequest();

            // Create the resource via merge
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitioner1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Spy on Collection.prototype.find before the update
            const findSpy = jest.spyOn(Collection.prototype, 'find');

            // Now update the resource — this triggers a read-before-write
            resp = await request
                .put(`/4_0_0/Practitioner/${practitioner1Resource.id}`)
                .send({ ...practitioner1Resource, active: false })
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            // Verify that at least one find call used ReadPreference.PRIMARY
            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBeGreaterThan(0);

            findSpy.mockRestore();
        });
    });

    describe('Merge uses ReadPreference.PRIMARY', () => {
        test('$merge operation reads existing resource from primary', async () => {
            const request = await createTestRequest();

            // First create via merge
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitioner1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Spy on Collection.prototype.find before the second merge (update path)
            const findSpy = jest.spyOn(Collection.prototype, 'find');

            // Merge again — this triggers a read-before-write for existing resource
            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send({ ...practitioner1Resource, active: false })
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ updated: true });

            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBeGreaterThan(0);

            findSpy.mockRestore();
        });
    });

    describe('Patch uses ReadPreference.PRIMARY', () => {
        test('PATCH operation reads existing resource from primary', async () => {
            const request = await createTestRequest();

            // Create the resource via merge
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitioner1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Spy on Collection.prototype.find before the patch
            const findSpy = jest.spyOn(Collection.prototype, 'find');

            // Patch the resource
            resp = await request
                .patch(`/4_0_0/Practitioner/${practitioner1Resource.id}`)
                .send([{ op: 'replace', path: '/active', value: false }])
                .set(getHeaders())
                .set('Content-Type', 'application/json-patch+json');
            expect(resp).toHaveStatusCode(200);

            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBeGreaterThan(0);

            findSpy.mockRestore();
        });
    });

    describe('Delete uses ReadPreference.PRIMARY', () => {
        test('DELETE operation reads existing resource from primary', async () => {
            const request = await createTestRequest();

            // Create the resource via merge
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitioner1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Spy on Collection.prototype.find before the delete
            const findSpy = jest.spyOn(Collection.prototype, 'find');

            // Delete the resource
            resp = await request
                .delete(`/4_0_0/Practitioner/${practitioner1Resource.id}`)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(204);

            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBeGreaterThan(0);

            findSpy.mockRestore();
        });
    });

    describe('Delete $everything uses ReadPreference.PRIMARY', () => {
        test('DELETE $everything reads connected resources from primary', async () => {
            const request = await createTestRequest();

            // Create a Patient via merge
            const patientResource = {
                resourceType: 'Patient',
                id: 'patient-primary-test',
                meta: {
                    source: 'http://test.org',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                birthDate: '1990-01-01',
                gender: 'male'
            };

            let resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Create an Observation linked to the Patient via merge
            const observationResource = {
                resourceType: 'Observation',
                id: 'obs-primary-test',
                meta: {
                    source: 'http://test.org',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                status: 'final',
                code: { coding: [{ system: 'http://loinc.org', code: '12345' }] },
                subject: { reference: 'Patient/patient-primary-test' }
            };

            resp = await request
                .post('/4_0_0/Observation/1/$merge')
                .send(observationResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Spy on Collection.prototype.find before delete $everything
            const findSpy = jest.spyOn(Collection.prototype, 'find');

            // Delete everything for the patient
            resp = await request
                .delete('/4_0_0/Patient/patient-primary-test/$everything')
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            // Verify that at least one find call used ReadPreference.PRIMARY
            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBeGreaterThan(0);

            findSpy.mockRestore();
        });
    });

    describe('Read does NOT use ReadPreference.PRIMARY', () => {
        test('GET operation does not force primary read', async () => {
            const request = await createTestRequest();

            // Create the resource via merge
            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitioner1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Spy on Collection.prototype.find before the GET
            const findSpy = jest.spyOn(Collection.prototype, 'find');

            // Read the resource
            resp = await request
                .get('/4_0_0/Practitioner/')
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            // Verify that NO find call used ReadPreference.PRIMARY
            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBe(0);

            findSpy.mockRestore();
        });
    });

    describe('$everything read does NOT use ReadPreference.PRIMARY', () => {
        test('GET $everything does not force primary read', async () => {
            const request = await createTestRequest();

            const patientResource = {
                resourceType: 'Patient',
                id: 'patient-read-test',
                meta: {
                    source: 'http://test.org',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                birthDate: '1990-01-01',
                gender: 'male'
            };

            let resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const findSpy = jest.spyOn(Collection.prototype, 'find');

            resp = await request
                .get('/4_0_0/Patient/patient-read-test/$everything')
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBe(0);

            findSpy.mockRestore();
        });
    });

    describe('$graph read does NOT use ReadPreference.PRIMARY', () => {
        test('POST $graph (read) does not force primary read', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitioner1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const graphDefinition = {
                resourceType: 'GraphDefinition',
                id: 'test-graph',
                name: 'test_graph',
                status: 'active',
                start: 'Practitioner',
                link: []
            };

            const findSpy = jest.spyOn(Collection.prototype, 'find');

            resp = await request
                .post(`/4_0_0/Practitioner/$graph?id=${practitioner1Resource.id}&contained=true`)
                .send(graphDefinition)
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            const callsWithPrimary = findSpy.mock.calls.filter(
                ([_query, options]) => options?.readPreference === ReadPreference.PRIMARY ||
                    options?.readPreference?.mode === 'primary'
            );
            expect(callsWithPrimary.length).toBe(0);

            findSpy.mockRestore();
        });
    });
});
