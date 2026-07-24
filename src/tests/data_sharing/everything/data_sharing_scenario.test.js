// This test case contains bwell master person & patient along with client person and client-1 person linked with master person.
// Client person is further linked with 4 client patients[2 of them are proa patient, & 1 is hie patient].
// Client-1 person is further linked with 2 patients[1 of them is proa patient].
// All patients further have observations resources linked with.
// Here we will test the data for $everything endpoint for different cases.

const masterPersonResource = require('./fixtures/person/master_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');

const clientPersonResource = require('./fixtures/person/client_person.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');

const client1PersonResource = require('./fixtures/person/client_1_person.json');
const client1PatientResource = require('./fixtures/patient/client_1_patient.json');
const client1ObservationResource = require('./fixtures/observation/client_1_observation.json');

const proaPatient1Resource = require('./fixtures/patient/proa_patient_1.json');
const proaObservation1Resource = require('./fixtures/observation/proa_observation_1.json');
const proaPatient2Resource = require('./fixtures/patient/proa_patient_2.json');
const proaObservation2Resource = require('./fixtures/observation/proa_observation_2.json');

const hieTreatmentPatientResource = require('./fixtures/patient/hie_patient.json');
const hieTreatmentObservationResource = require('./fixtures/observation/hie_observation.json');

const clientConsentGivenResource = require('./fixtures/consent/client_consent_given.json');
const clientConsentDeniedResource = require('./fixtures/consent/client_consent_denied.json');

const expectedResponse1Resource = require('./fixtures/expected/expected_response_1.json');
const expectedResponse2Resource = require('./fixtures/expected/expected_response_2.json');
const expectedResponse3Resource = require('./fixtures/expected/expected_response_3.json');
const expectedResponse4Resource = require('./fixtures/expected/expected_response_4.json');
const expectedResponse5Resource = require('./fixtures/expected/expected_response_5.json');
const expectedResponse6Resource = require('./fixtures/expected/expected_response_6.json');
const expectedResponse7Resource = require('./fixtures/expected/expected_response_7.json');
const expectedResponse7Resource1 = require('./fixtures/expected/expected_response_7_1.json');
const expectedResponse8Resource = require('./fixtures/expected/expected_response_8.json');
const expectedResponse9Resource = require('./fixtures/expected/expected_response_9.json');
const expectedResponse10Resource = require('./fixtures/expected/expected_response_10.json');
const expectedResponse11Resource = require('./fixtures/expected/expected_response_11.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const headers = getHeaders('user/*.read access/client.*');
const client1Headers = getHeaders('user/*.read access/client-1.*');
const healthServiceHeader = getHeaders('user/*.read access/health-service.*');
const healthService1Header = getHeaders('user/*.read access/health-service-1.*');
const healthService2Header = getHeaders('user/*.read access/health-service-2.*');

describe('Data sharing test cases for different scenarios', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Data Sharing Scenario for everything endpoint', () => {
        test('Everything operation on client person: Get client & hie data only & no proa data. when consent not provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedResponse1Resource);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1Resource);
        });

        test('Everything operation on client person: Get client and hie data only, & no proa data, when consent denied', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentDeniedResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse2Resource);
        });

        test('Everything operation on client person: Get client, proa & hie patient data, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse3Resource);
        });

        test('Everything operation on client person: Get data only for proa patient when access token of proa patient provided & no consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set(healthServiceHeader);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse4Resource);
        });

        test('Everything operation on client person: Get no data when access token matched & even consent provided', async () => {
            // We get no data here as access code for client person is not matched & further processing is not done.

            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set(healthServiceHeader);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse4Resource);
        });

        test('Everything operation on client patient: Get client patient data & not proa/hie patient, even consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce6/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse5Resource);
        });

        test('Everything operation on client patient-1: Only data of client patient-1 must be returned, regardless of consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7762e6-b7ac-470e-bde3-e85cee9d1ce6/$everything?_debug=true')
                .set(client1Headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse6Resource);
        });

        test('Everything operation on proa patient-1: Get linked client person and proa data, when consent provided', async () => {
            // Here access token 'client' is provided & consent is provided. So even we are fetching proa patient, we get linked client person.
            // If consent is not provided here, then this client person would not come.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce7/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse7Resource);
        });

        test('Everything operation on proa patient-1: Get all linked data, with appropriate access token, consent provided', async () => {
            // Here client person is not received as it's access token is different.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce7/$everything?_debug=true')
                .set(healthServiceHeader);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse8Resource);
        });

        test('Everything operation on proa patient-2: Get linked client person and proa data, with different access token and consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce8/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse7Resource1);
        });

        test('Everything operation on proa patient-2: Get all linked data, with appropriate access token, consent provided', async () => {
            // Here client person is not received as it's access token is different.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce8/$everything')
                .set(healthService1Header);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse9Resource);
        });

        test('Everything operation on hie/treatment patient: Get linked client person and hie data, with different access token, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/d4c639de-f892-5b89-a63c-f64f0f2d69d1/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse10Resource);
        });

        test('Everything operation on hie/treatment patient: Get all linked data, with appropriate access token, even no consent provided', async () => {
            // Here client person is not received as it's access token is different.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/d4c639de-f892-5b89-a63c-f64f0f2d69d1/$everything?_debug=true')
                .set(healthService2Header);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse11Resource);
        });

        test('With consent given and batch size 1, each chunk query is scoped to patient UUIDs — not unbounded', async () => {
            // Force batch size = 1 so each patient is processed in its own chunk.
            // This exercises the everythingChunkIndex cache-scoping fix.
            // Without the fix, chunks 2+ reuse chunk 1's allowedPatientIds, producing
            // a bare { meta.tag: NOT hidden, connectionType: proa } query with no patient scoping.
            // With the fix, every $or arm must contain patient-specific filters.
            const request = await createTestRequest((c) => {
                Object.defineProperty(c.configManager, 'everythingBatchSize', {
                    get: () => 1,
                    configurable: true
                });
                return c;
            });

            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            expect(resp.status).toBe(200);

            // Extract all query strings from debug meta tags
            const metaTags = resp.body?.meta?.tag || [];
            const queryDisplays = metaTags
                .filter((t) => t.system === 'https://www.icanbwell.com/query')
                .flatMap((t) => t.display.split('|'));

            // Every $or query must have at least one arm that scopes to patient UUIDs or connectionType.
            // A bare { meta.tag: NOT hidden } only query (no _uuid, no connectionType) indicates
            // the unbounded scan bug is present.
            for (const queryStr of queryDisplays) {
                let parsedQuery;
                try {
                    const firstParen = queryStr.indexOf('(');
                    const lastCommaOutside = (() => {
                        let depth = 0, last = -1;
                        for (let i = firstParen + 1; i < queryStr.length; i++) {
                            if (queryStr[i] === '{') depth++;
                            else if (queryStr[i] === '}') depth--;
                            else if (queryStr[i] === ',' && depth === 0) last = i;
                        }
                        return last;
                    })();
                    parsedQuery = JSON.parse(
                        queryStr.substring(firstParen + 1, lastCommaOutside).replace(/'/g, '"')
                    );
                } catch {
                    continue;
                }
                if (!parsedQuery?.$or) {
                    continue;
                }
                // Each arm of the $or must contain something beyond just meta.tag
                for (const arm of parsedQuery.$or) {
                    const armStr = JSON.stringify(arm);
                    const hasPatientScope = armStr.includes('_uuid');
                    expect(hasPatientScope).toBe(true);
                }
            }
        });

        test('Without consent and batch size 1, PROA observations do not appear from any chunk', async () => {
            // Force batch size = 1 so each patient is its own chunk.
            // Without consent, the patientFilterEmptied guard must return null for PROA arms
            // in every chunk — no PROA observations should leak across chunk boundaries.
            const request = await createTestRequest((c) => {
                Object.defineProperty(c.configManager, 'everythingBatchSize', {
                    get: () => 1,
                    configurable: true
                });
                return c;
            });

            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, proaPatient1Resource, proaObservation1Resource,
                    proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            expect(resp.status).toBe(200);

            const entries = resp.body.entry || [];
            const observationIds = entries
                .filter((e) => e.resource?.resourceType === 'Observation')
                .map((e) => e.resource.id);

            // PROA observations must not appear without consent — in any chunk
            expect(observationIds).not.toContain(proaObservation1Resource.id);
            expect(observationIds).not.toContain(proaObservation2Resource.id);

            // Client observation must still be returned
            expect(observationIds).toContain(clientObservationResource.id);
        });
    });
});
