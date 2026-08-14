'use strict';

/**
 * Per-tool coverage for every generated dedicated MCP search_<resource> tool
 * (generatorScripts/mcp/commonly_used_resources.json / src/mcp/tools/*.tool.js). Prior to this
 * file, only search_patient and search_observation had any test coverage (in
 * ../mcpEndpoint.integration.test.js, which focuses on auth/consent/scope/rewriter behavior, not
 * per-tool schema correctness) -- the other 12 generated tools were completely untested: nothing
 * ever proved their generated inputSchema field names actually match this server's real search
 * parameters for that resource type.
 *
 * Each test creates real FHIR data via the app's actual $merge endpoint (same pattern as
 * ../mcpEndpoint.integration.test.js and e.g. src/tests/patient/search_by_id), then calls that
 * resource type's dedicated tool filtering by `_id` and asserts the created resource comes back --
 * a minimal, direct proof that each tool's resourceType/inputSchema wiring works end-to-end
 * against real data, not just against mocks.
 */
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getFullAccessToken,
    createTestRequest
} = require('../../common');
const {
    callMcpTool,
    bundleFromToolResult,
    idsInBundle,
    makePatient,
    makeObservation,
    makePerson,
    makeCondition,
    makeMedicationRequest,
    makeMedicationDispense,
    makeAllergyIntolerance,
    makeImmunization,
    makeProcedure,
    makeDiagnosticReport,
    makeEncounter,
    makeCarePlan,
    makeCoverage,
    makeDocumentReference,
    makePractitioner,
    makeOrganization,
    makeComposition,
    makeSubscription,
    makeSubscriptionStatus,
    makeSubscriptionTopic,
    makeAppointment,
    makeServiceRequest,
    makeMedicationStatement,
    makeCareTeam,
    makeGoal,
    makeFamilyMemberHistory,
    makeImmunizationRecommendation,
    makeExplanationOfBenefit,
    makeClaim,
    makeQuestionnaireResponse,
    makeRelatedPerson
} = require('../mcpTestHelpers');

describe('/mcp dedicated tools', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    /**
     * Creates a Patient (most dedicated tools' fixtures reference one) and returns its id.
     * @param {import('supertest').Test} request
     * @param {string} id
     * @returns {Promise<string>}
     */
    async function createPatient (request, id) {
        const resp = await request
            .post(`/4_0_0/Patient/${id}/$merge?validate=true`)
            .send(makePatient(id, { family: 'Test', given: 'MCP', birthDate: '1990-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        return id;
    }

    /**
     * Creates an Organization and a Coverage referencing it (the fixture pair
     * ExplanationOfBenefit/Claim both require) and returns the ids used.
     * @param {import('supertest').Test} request
     * @param {{patientId: string, organizationId: string, coverageId: string, orgName: string}} params
     */
    async function createOrganizationAndCoverage (request, { patientId, organizationId, coverageId, orgName }) {
        const orgResp = await request
            .post(`/4_0_0/Organization/${organizationId}/$merge?validate=true`)
            .send(makeOrganization(organizationId, orgName))
            .set(getHeaders());
        expect(orgResp).toHaveMergeResponse({ created: true });
        const coverageResp = await request
            .post(`/4_0_0/Coverage/${coverageId}/$merge?validate=true`)
            .send(makeCoverage(coverageId, { patientId, payorOrgId: organizationId }))
            .set(getHeaders());
        expect(coverageResp).toHaveMergeResponse({ created: true });
    }

    /**
     * Creates the given resource via $merge, calls its dedicated MCP tool filtered by `_id`, and
     * asserts the created resource's id is the only thing in the result.
     * @param {import('supertest').Test} request
     * @param {Object} resource a full FHIR resource, including resourceType and id
     * @param {string} toolName
     */
    async function assertDedicatedToolFindsResourceById (request, resource, toolName) {
        const mergeResp = await request
            .post(`/4_0_0/${resource.resourceType}/${resource.id}/$merge?validate=true`)
            .send(resource)
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const { rpc } = await callMcpTool(request, getFullAccessToken(), toolName, { _id: resource.id });

        expect(rpc.result.isError).toBeUndefined();
        expect(idsInBundle(bundleFromToolResult(rpc))).toEqual([resource.id]);
    }

    test('search_patient finds a created Patient by _id', async () => {
        const request = await createTestRequest();
        await assertDedicatedToolFindsResourceById(
            request,
            makePatient('mcp-tool-patient', { family: 'Smith', given: 'Pat', birthDate: '1990-01-01' }),
            'search_patient'
        );
    });

    test('search_observation finds a created Observation by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-obs-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeObservation('mcp-tool-observation', { patientId, system: 'http://loinc.org', code: '1111-1' }),
            'search_observation'
        );
    });

    test('search_condition finds a created Condition by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-condition-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeCondition('mcp-tool-condition', { patientId, code: '38341003' }),
            'search_condition'
        );
    });

    test('search_medication_request finds a created MedicationRequest by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-medreq-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeMedicationRequest('mcp-tool-medication-request', { patientId, code: '206765' }),
            'search_medication_request'
        );
    });

    test('search_allergy_intolerance finds a created AllergyIntolerance by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-allergy-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeAllergyIntolerance('mcp-tool-allergy-intolerance', { patientId, code: '227493005' }),
            'search_allergy_intolerance'
        );
    });

    test('search_immunization finds a created Immunization by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-immunization-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeImmunization('mcp-tool-immunization', { patientId, code: '141' }),
            'search_immunization'
        );
    });

    test('search_procedure finds a created Procedure by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-procedure-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeProcedure('mcp-tool-procedure', { patientId, code: '80146002' }),
            'search_procedure'
        );
    });

    test('search_diagnostic_report finds a created DiagnosticReport by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-diagreport-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeDiagnosticReport('mcp-tool-diagnostic-report', { patientId, code: '58410-2' }),
            'search_diagnostic_report'
        );
    });

    test('search_encounter finds a created Encounter by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-encounter-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeEncounter('mcp-tool-encounter', { patientId }),
            'search_encounter'
        );
    });

    test('search_care_plan finds a created CarePlan by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-careplan-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeCarePlan('mcp-tool-care-plan', { patientId }),
            'search_care_plan'
        );
    });

    test('search_coverage finds a created Coverage by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-coverage-patient');
        const payorOrgId = 'mcp-tool-coverage-payor-org';
        const orgResp = await request
            .post(`/4_0_0/Organization/${payorOrgId}/$merge?validate=true`)
            .send(makeOrganization(payorOrgId, 'Test Payor'))
            .set(getHeaders());
        expect(orgResp).toHaveMergeResponse({ created: true });

        await assertDedicatedToolFindsResourceById(
            request,
            makeCoverage('mcp-tool-coverage', { patientId, payorOrgId }),
            'search_coverage'
        );
    });

    test('search_document_reference finds a created DocumentReference by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-docref-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeDocumentReference('mcp-tool-document-reference', { patientId }),
            'search_document_reference'
        );
    });

    test('search_practitioner finds a created Practitioner by _id', async () => {
        const request = await createTestRequest();
        await assertDedicatedToolFindsResourceById(
            request,
            makePractitioner('mcp-tool-practitioner', { family: 'Who', given: 'Doctor' }),
            'search_practitioner'
        );
    });

    test('search_organization finds a created Organization by _id', async () => {
        const request = await createTestRequest();
        await assertDedicatedToolFindsResourceById(
            request,
            makeOrganization('mcp-tool-organization', 'Test Organization'),
            'search_organization'
        );
    });

    test('search_person finds a created Person by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-person-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makePerson('mcp-tool-person', [patientId]),
            'search_person'
        );
    });

    test('search_medication_dispense finds a created MedicationDispense by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-meddispense-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeMedicationDispense('mcp-tool-medication-dispense', { patientId, code: '206765' }),
            'search_medication_dispense'
        );
    });

    test('search_composition finds a created Composition by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-composition-patient');
        const authorOrgId = 'mcp-tool-composition-author-org';
        const orgResp = await request
            .post(`/4_0_0/Organization/${authorOrgId}/$merge?validate=true`)
            .send(makeOrganization(authorOrgId, 'Test Author Org'))
            .set(getHeaders());
        expect(orgResp).toHaveMergeResponse({ created: true });

        await assertDedicatedToolFindsResourceById(
            request,
            makeComposition('mcp-tool-composition', { patientId, authorOrgId }),
            'search_composition'
        );
    });

    test('search_subscription finds a created Subscription by _id', async () => {
        const request = await createTestRequest();
        await assertDedicatedToolFindsResourceById(
            request,
            makeSubscription('mcp-tool-subscription', { clientPersonId: 'mcp-tool-subscription-person' }),
            'search_subscription'
        );
    });

    test('search_subscription_status finds a created SubscriptionStatus by _id', async () => {
        const request = await createTestRequest();
        await assertDedicatedToolFindsResourceById(
            request,
            makeSubscriptionStatus('mcp-tool-subscription-status', { clientPersonId: 'mcp-tool-subscription-status-person' }),
            'search_subscription_status'
        );
    });

    test('search_subscription_topic finds a created SubscriptionTopic by _id', async () => {
        const request = await createTestRequest();
        await assertDedicatedToolFindsResourceById(
            request,
            makeSubscriptionTopic('mcp-tool-subscription-topic', { clientPersonId: 'mcp-tool-subscription-topic-person' }),
            'search_subscription_topic'
        );
    });

    test('search_appointment finds a created Appointment by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-appointment-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeAppointment('mcp-tool-appointment', { patientId }),
            'search_appointment'
        );
    });

    test('search_service_request finds a created ServiceRequest by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-servicerequest-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeServiceRequest('mcp-tool-service-request', { patientId, code: '169069000' }),
            'search_service_request'
        );
    });

    test('search_medication_statement finds a created MedicationStatement by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-medstatement-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeMedicationStatement('mcp-tool-medication-statement', { patientId, code: '197361' }),
            'search_medication_statement'
        );
    });

    test('search_care_team finds a created CareTeam by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-careteam-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeCareTeam('mcp-tool-care-team', { patientId }),
            'search_care_team'
        );
    });

    test('search_goal finds a created Goal by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-goal-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeGoal('mcp-tool-goal', { patientId }),
            'search_goal'
        );
    });

    test('search_family_member_history finds a created FamilyMemberHistory by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-fmh-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeFamilyMemberHistory('mcp-tool-family-member-history', { patientId }),
            'search_family_member_history'
        );
    });

    test('search_immunization_recommendation finds a created ImmunizationRecommendation by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-immrec-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeImmunizationRecommendation('mcp-tool-immunization-recommendation', { patientId }),
            'search_immunization_recommendation'
        );
    });

    test('search_explanation_of_benefit finds a created ExplanationOfBenefit by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-eob-patient');
        const organizationId = 'mcp-tool-eob-org';
        const coverageId = 'mcp-tool-eob-coverage';
        await createOrganizationAndCoverage(request, { patientId, organizationId, coverageId, orgName: 'Test EOB Org' });

        await assertDedicatedToolFindsResourceById(
            request,
            makeExplanationOfBenefit('mcp-tool-explanation-of-benefit', { patientId, organizationId, coverageId }),
            'search_explanation_of_benefit'
        );
    });

    test('search_claim finds a created Claim by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-claim-patient');
        const organizationId = 'mcp-tool-claim-org';
        const coverageId = 'mcp-tool-claim-coverage';
        await createOrganizationAndCoverage(request, { patientId, organizationId, coverageId, orgName: 'Test Claim Org' });

        await assertDedicatedToolFindsResourceById(
            request,
            makeClaim('mcp-tool-claim', { patientId, organizationId, coverageId }),
            'search_claim'
        );
    });

    test('search_questionnaire_response finds a created QuestionnaireResponse by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-qr-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeQuestionnaireResponse('mcp-tool-questionnaire-response', { patientId }),
            'search_questionnaire_response'
        );
    });

    test('search_related_person finds a created RelatedPerson by _id', async () => {
        const request = await createTestRequest();
        const patientId = await createPatient(request, 'mcp-tool-relatedperson-patient');
        await assertDedicatedToolFindsResourceById(
            request,
            makeRelatedPerson('mcp-tool-related-person', { patientId }),
            'search_related_person'
        );
    });
});
