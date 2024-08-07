// claim
const claimResource = require('./fixtures/claim/explanation_of_benefits.json');
const practitionerResource = require('./fixtures/claim/practitioner.json');
const organizationResource = require('./fixtures/claim/organization.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');

// expected
const expectedResource_230916613368 = require('./fixtures/expected/expected-WPS-Claim-230916613368.json');
const expectedResource_230916613369 = require('./fixtures/expected/expected-WPS-Claim-230916613369.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersNdJson
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { generateUUIDv5 } = require('../../../utils/uid.util');

describe('Claim Graph By Id Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph By Id Contained Tests', () => {
        test('Graph contained with multiple targets works properly', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1376656959/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Organization/1407857790/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$merge')
                .send(claimResource[0])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$merge')
                .send(claimResource[1])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$graph?contained=true')
                .set(getHeaders())
                .send(graphDefinitionResource);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613368);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$graph?contained=true')
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613369);

            const uuid = generateUUIDv5('WPS-Claim-230916613369|client');
            resp = await request
                .post(`/4_0_0/ExplanationOfBenefit/${uuid}/$graph?contained=true`)
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613369);
        });

        test('Graph contained with multiple targets works properly with ndjson', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1376656959/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Organization/1407857790/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$merge')
                .send(claimResource[0])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$merge')
                .send(claimResource[1])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$graph?contained=true')
                .set(getHeadersNdJson())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613368.entry[0].resource);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$graph?contained=true')
                .set(getHeadersNdJson())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613369.entry[0].resource);

            const uuid = generateUUIDv5('WPS-Claim-230916613369|client');
            resp = await request
                .post(`/4_0_0/ExplanationOfBenefit/${uuid}/$graph?contained=true`)
                .set(getHeadersNdJson())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613369.entry[0].resource);

            // Testing if graph definition passed as query param works
            resp = await request
                .post(
                    '/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$graph?contained=true&graph={"resourceType":"GraphDefinition","id":"o","name":"explanationofbenefit_references","status":"active","start":"ExplanationOfBenefit","link":[{"path":"patient","target":[{"type":"Patient"}]},{"path":"enterer","target":[{"type":"Practitioner"},{"type":"PractitionerRole"}]},{"path":"insurer","target":[{"type":"Organization"}]},{"path":"provider","target":[{"type":"Practitioner"},{"type":"PractitionerRole"},{"type":"Organization"}]},{"path":"related[x].claim","target":[{"type":"Claim"}]},{"path":"prescription","target":[{"type":"MedicationRequest"},{"type":"VisionPrescription"}]},{"path":"originalPrescription","target":[{"type":"MedicationRequest"}]},{"path":"careTeam[x].provider","target":[{"type":"Practitioner"},{"type":"PractitionerRole"},{"type":"Organization"}]},{"path":"diagnosis[x].diagnosisReference","target":[{"type":"Condition"}]},{"path":"procedure[x].procedureReference","target":[{"type":"Procedure"}]}]}'
                )
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613369.entry[0].resource);

            // Case when invalid graph definition provided
            resp = await request
                .post(
                    '/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$graph?contained=true&graph="resourceType":"GraphDefinition","id":"o","name":"explanationofbenefit_references","status":"active","start":"ExplanationOfBenefit","link":[{"path":"patient","target":[{"type":"Patient"}]},{"path":"enterer","target":[{"type":"Practitioner"},{"type":"PractitionerRole"}]},{"path":"insurer","target":[{"type":"Organization"}]},{"path":"provider","target":[{"type":"Practitioner"},{"type":"PractitionerRole"},{"type":"Organization"}]},{"path":"related[x].claim","target":[{"type":"Claim"}]},{"path":"prescription","target":[{"type":"MedicationRequest"},{"type":"VisionPrescription"}]},{"path":"originalPrescription","target":[{"type":"MedicationRequest"}]},{"path":"careTeam[x].provider","target":[{"type":"Practitioner"},{"type":"PractitionerRole"},{"type":"Organization"}]},{"path":"diagnosis[x].diagnosisReference","target":[{"type":"Condition"}]},{"path":"procedure[x].procedureReference","target":[{"type":"Procedure"}]}]}'
                )
                .set(getHeadersNdJson());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse({
                issue: [
                    {
                        severity: 'error',
                        code: 'internal',
                        details: {
                            text: 'Unexpected Error: Unexpected non-whitespace character after JSON at position 14'
                        },
                        diagnostics: "SyntaxError: Unexpected non-whitespace character after JSON at position 14\n    " + "at JSON.parse (<anonymous>)\n    " + "at GraphOperation.parse (/home/ubuntu/fhir-server/src/operations/graph/graph.js:146:101)\n    " + "at FhirOperationsManager.graph (/home/ubuntu/fhir-server/src/operations/fhirOperationsManager.js:852:28)\n    " + "at /home/ubuntu/fhir-server/src/middleware/fhir/4_0_0/controllers/operations.controller.js:72:32"
                    }
                ],
                resourceType: 'OperationOutcome'
            });
        });
    });
});
