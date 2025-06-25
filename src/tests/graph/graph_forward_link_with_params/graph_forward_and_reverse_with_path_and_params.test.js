const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

// Load existing fixtures
const patientTest = require('./fixtures/Patient/patient.json');
const activeMaleDoc = require('./fixtures/Practitioner/active-male-doc.json');
const inactiveFemaleDoc = require('./fixtures/Practitioner/inactive-female-doc.json');

// Load encounter fixtures
const patientWithEncounters = require('./fixtures/Patient/patient-with-encounters.json');
const activeEncounter = require('./fixtures/Encounter/active-encounter.json');
const finishedEncounter = require('./fixtures/Encounter/finished-encounter.json');
const expectedPatientWithFilteredPractitioner= require('./fixtures/expected/expectedPatientWithFilteredPractitioner.json');
const expectedPatientWithReverseLinkEncounters = require('./fixtures/expected/expectedPatientWithReverseLinkEncounters.json');
const expectedPatientWithMultipleTargetPractitioners = require('./fixtures/expected/expectedPatientWithMultipleTargetPractitioners.json');
const expectedPatientWithAllReferencedPractitioners = require('./fixtures/expected/expectedPatientWithAllReferencedPractitioners.json');

describe('GraphOperation Forward Link with Params Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph with forward link and params filtering', () => {
        test('should filter referenced resources using params in target', async () => {
            const request = await createTestRequest();

            // Test GraphDefinition with target.params (FHIR spec compliant)
            const graphDefinition = {
                resourceType: 'GraphDefinition',
                id: 'test-forward-link-params',
                name: 'TestForwardLinkParams',
                status: 'active',
                start: 'Patient',
                link: [
                    {
                        path: 'generalPractitioner',
                        target: [
                            {
                                type: 'Practitioner',
                                params: 'active=true&gender=male'
                            }
                        ]
                    }
                ]
            };

            // Insert test data using existing fixtures
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send([patientTest, activeMaleDoc, inactiveFemaleDoc])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Execute graph operation
            resp = await request
                .post('/4_0_0/Patient/test-patient/$graph')
                .send(graphDefinition)
                .set(getHeaders())
                .expect(200);

            expect(resp).toBeDefined();
            expect(resp.body.resourceType).toBe('Bundle');

            expect(resp).toHaveResponse(expectedPatientWithFilteredPractitioner);
        });

        test('should handle reverse link with target params and security filtering', async () => {
            const request = await createTestRequest();

            // GraphDefinition with reverse link and params (using working syntax)
            const graphDefinition = {
                resourceType: 'GraphDefinition',
                id: 'test-reverse-link-params',
                name: 'TestReverseLinkParams',
                status: 'active',
                start: 'Patient',
                link: [
                    {
                        target: [
                            {
                                type: 'Encounter',
                                params: 'subject={ref}&status=in-progress'
                            }
                        ]
                    }
                ]
            };

            // Insert test data using fixtures
            let resp = await request
                .post('/4_0_0/Patient/3/$merge?validate=true')
                .send([patientWithEncounters, activeEncounter, finishedEncounter])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Execute graph operation
            resp = await request
                .post('/4_0_0/Patient/patient-with-encounters/$graph')
                .send(graphDefinition)
                .set(getHeaders())
                .expect(200);

            expect(resp).toBeDefined();
            expect(resp.body.resourceType).toBe('Bundle');

            expect(resp).toHaveResponse(expectedPatientWithReverseLinkEncounters);

        });

        test('should handle multiple targets with different params', async () => {
            const request = await createTestRequest();

            // GraphDefinition with multiple targets having different params
            const graphDefinition = {
                resourceType: 'GraphDefinition',
                id: 'test-multiple-targets-params',
                name: 'TestMultipleTargetsParams',
                status: 'active',
                start: 'Patient',
                link: [
                    {
                        path: 'generalPractitioner',
                        target: [
                            {
                                type: 'Practitioner',
                                params: 'active=true'
                            },
                            {
                                type: 'Practitioner',
                                params: 'gender=female'
                            }
                        ]
                    }
                ]
            };

            // Insert test data using existing fixtures
            let resp = await request
                .post('/4_0_0/Patient/4/$merge?validate=true')
                .send([patientTest, activeMaleDoc, inactiveFemaleDoc])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Execute graph operation
            resp = await request
                .post('/4_0_0/Patient/test-patient/$graph')
                .send(graphDefinition)
                .set(getHeaders())
                .expect(200);

            expect(resp).toBeDefined();
            expect(resp.body.resourceType).toBe('Bundle');

            expect(resp).toHaveResponse(expectedPatientWithMultipleTargetPractitioners);
        });

        test('should work without params (backward compatibility)', async () => {
            const request = await createTestRequest();

            // GraphDefinition without params should work as before
            const graphDefinition = {
                resourceType: 'GraphDefinition',
                id: 'test-forward-link-no-params',
                name: 'TestForwardLinkNoParams',
                status: 'active',
                start: 'Patient',
                link: [
                    {
                        path: 'generalPractitioner',
                        target: [
                            {
                                type: 'Practitioner'
                            }
                        ]
                    }
                ]
            };

            // Insert test data using existing fixtures
            let resp = await request
                .post('/4_0_0/Patient/2/$merge?validate=true')
                .send([patientTest, activeMaleDoc, inactiveFemaleDoc])
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Execute graph operation
            resp = await request
                .post('/4_0_0/Patient/test-patient/$graph')
                .send(graphDefinition)
                .set(getHeaders())
                .expect(200);

            expect(resp).toBeDefined();
            expect(resp.body.resourceType).toBe('Bundle');

            expect(resp).toHaveResponse(expectedPatientWithAllReferencedPractitioners);

        });
    });
});
