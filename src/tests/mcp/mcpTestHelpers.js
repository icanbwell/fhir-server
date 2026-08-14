'use strict';

/**
 * Shared helpers for /mcp integration tests -- extracted from mcpEndpoint.integration.test.js so
 * per-tool test files (see dedicated_tools/) don't each hand-duplicate the SSE/JSON-RPC parsing.
 */
const { generateUUIDv5 } = require('../../utils/uid.util');
const { getHeadersWithCustomPayload } = require('../common');

/**
 * A patient-scoped caller's identity (SEC-1580 IDG-5, #2481) is now matched strictly against
 * the Person collection's _uuid field, never falling back to _sourceId -- so a JWT's
 * clientFhirPersonId/bwellFhirPersonId claim must carry the Person's real _uuid, not the raw
 * FHIR `id` used to create it in a test fixture. UuidColumnHandler computes
 * _uuid = generateUUIDv5(`${id}|${sourceAssigningAuthority}`) for any non-uuid id, and
 * SourceAssigningAuthorityColumnHandler falls back to the first owner security tag's code when
 * no explicit sourceAssigningAuthority tag is present -- which for every Person built with
 * minimalSecurity()'s default owner is 'client'. This mirrors that derivation so tests can use
 * readable ids (e.g. 'mcp-t6-person') while still presenting a JWT identity the traversal will
 * actually resolve.
 * @param {string} personId the raw FHIR `id` a test Person was created with
 * @param {string} [owner] the owner tag used when creating the Person (minimalSecurity()'s default is 'client')
 * @returns {string}
 */
function personUuid (personId, owner = 'client') {
    return generateUUIDv5(`${personId}|${owner}`);
}

/**
 * A patient-scoped JWT payload whose clientFhirPersonId/bwellFhirPersonId is the given
 * personId's Person._uuid (SEC-1580 IDG-5, #2481, tightened this to an exact _uuid match with
 * no _sourceId fallback -- see personUuid's doc comment above). Full user/access grants are
 * included alongside the patient scope so that scope *narrowing* (not an outright access
 * denial) is what's under test -- mirrors src/tests/graphqlv2/observation/observation.test.js's
 * getGraphQLHeadersWithPerson usage and src/tests/patientScope/search_with_clientfhirpersonid's
 * jwt_payload shape.
 * @param {string} personId
 * @param {Object} [overrides]
 * @returns {string} raw bearer token (no 'Bearer ' prefix)
 */
function patientScopedToken (personId, overrides = {}) {
    return getHeadersWithCustomPayload({
        scope: 'patient/*.read user/*.* access/*.*',
        username: `${personId}@example.com`,
        clientFhirPersonId: personUuid(personId),
        clientFhirPatientId: 'clientFhirPatient',
        bwellFhirPersonId: personUuid(personId),
        bwellFhirPatientId: 'bwellFhirPatient',
        token_use: 'access',
        ...overrides
    }).Authorization.replace(/^Bearer /, '');
}

/**
 * Extracts the JSON-RPC envelope out of an MCP SSE response body
 * (`event: message\ndata: {...}\n\n`). supertest does not parse SSE into `resp.body`, so the
 * envelope must be pulled out of `resp.text` by hand.
 * @param {import('supertest').Response} resp
 * @returns {{jsonrpc: string, id: number, result?: Object, error?: Object}}
 */
function parseMcpRpcResponse (resp) {
    const match = resp.text && resp.text.match(/^data: (.+)$/m);
    if (!match) {
        throw new Error(
            `Expected an SSE 'data:' line in the /mcp response but found none. status=${resp.status} text=${resp.text}`
        );
    }
    return JSON.parse(match[1]);
}

/**
 * Issues a JSON-RPC tools/call request against /mcp and returns both the raw supertest response
 * and the parsed JSON-RPC envelope.
 * @param {import('supertest').Test} request
 * @param {string} bearerToken
 * @param {string} name
 * @param {Object} [args]
 * @returns {Promise<{resp: import('supertest').Response, rpc: Object}>}
 */
async function callMcpTool (request, bearerToken, name, args) {
    const resp = await request
        .post('/mcp')
        .set({
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${bearerToken}`
        })
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } });
    return { resp, rpc: parseMcpRpcResponse(resp) };
}

/**
 * Parses the FHIR Bundle a tool call result carries as JSON text in content[0].text.
 * @param {Object} rpc parsed JSON-RPC envelope from parseMcpRpcResponse
 * @returns {Object} FHIR Bundle
 */
function bundleFromToolResult (rpc) {
    return JSON.parse(rpc.result.content[0].text);
}

/**
 * @param {Object} bundle FHIR searchset Bundle
 * @returns {string[]} ids of every resource in the bundle
 */
function idsInBundle (bundle) {
    return (bundle.entry || []).map((e) => e.resource.id);
}

/**
 * @param {string} [owner]
 * @returns {Array<{system: string, code: string}>}
 */
function minimalSecurity (owner = 'client') {
    return [
        { system: 'https://www.icanbwell.com/access', code: owner },
        { system: 'https://www.icanbwell.com/owner', code: owner }
    ];
}

// ---------------------------------------------------------------------------------------------
// Minimal FHIR-resource builders, one per resourceType exercised by an MCP dedicated tool
// (see generatorScripts/mcp/commonly_used_resources.json). Each includes only the fields FHIR R4
// actually requires (plus enough to be identifiable/filterable in a test), not a realistic
// clinical example -- these exist to prove each generated search_<resource> tool's wiring works
// against real created data, not to model real-world resource content.
// ---------------------------------------------------------------------------------------------

function makePatient (id, { family, given, birthDate }) {
    return {
        resourceType: 'Patient',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        name: [{ use: 'official', family, given: [given] }],
        birthDate,
        gender: 'unknown'
    };
}

function makeLocation (id, name) {
    return {
        resourceType: 'Location',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        name
    };
}

function makeObservation (id, { patientId, system, code }) {
    return {
        resourceType: 'Observation',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'final',
        code: { coding: [{ system, code, display: 'Test code' }] },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makePerson (id, linkedPatientIds) {
    return {
        resourceType: 'Person',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        active: true,
        link: linkedPatientIds.map((patientId) => ({ target: { reference: `Patient/${patientId}` } }))
    };
}

function makeCondition (id, { patientId, code }) {
    return {
        resourceType: 'Condition',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        code: { coding: [{ system: 'http://snomed.info/sct', code, display: 'Test condition' }] },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeMedicationRequest (id, { patientId, code }) {
    return {
        resourceType: 'MedicationRequest',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: {
            coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code, display: 'Test medication' }]
        },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeMedicationDispense (id, { patientId, code }) {
    return {
        resourceType: 'MedicationDispense',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'completed',
        medicationCodeableConcept: {
            coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code, display: 'Test medication' }]
        },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeAllergyIntolerance (id, { patientId, code }) {
    return {
        resourceType: 'AllergyIntolerance',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        code: { coding: [{ system: 'http://snomed.info/sct', code, display: 'Test allergy' }] },
        patient: { reference: `Patient/${patientId}` }
    };
}

function makeImmunization (id, { patientId, code }) {
    return {
        resourceType: 'Immunization',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'completed',
        vaccineCode: { coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code, display: 'Test vaccine' }] },
        patient: { reference: `Patient/${patientId}` },
        occurrenceDateTime: '2024-01-01'
    };
}

function makeProcedure (id, { patientId, code }) {
    return {
        resourceType: 'Procedure',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'completed',
        code: { coding: [{ system: 'http://snomed.info/sct', code, display: 'Test procedure' }] },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeDiagnosticReport (id, { patientId, code }) {
    return {
        resourceType: 'DiagnosticReport',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code, display: 'Test report' }] },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeEncounter (id, { patientId }) {
    return {
        resourceType: 'Encounter',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeCarePlan (id, { patientId }) {
    return {
        resourceType: 'CarePlan',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        intent: 'plan',
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeCoverage (id, { patientId, payorOrgId }) {
    return {
        resourceType: 'Coverage',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        beneficiary: { reference: `Patient/${patientId}` },
        payor: [{ reference: `Organization/${payorOrgId}` }]
    };
}

function makeDocumentReference (id, { patientId }) {
    return {
        resourceType: 'DocumentReference',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'current',
        subject: { reference: `Patient/${patientId}` },
        content: [{ attachment: { contentType: 'text/plain', title: 'Test document' } }]
    };
}

function makePractitioner (id, { family, given }) {
    return {
        resourceType: 'Practitioner',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        name: [{ use: 'official', family, given: [given] }]
    };
}

function makeOrganization (id, name) {
    return {
        resourceType: 'Organization',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        name
    };
}

/**
 * The b.well-specific system URI patientFilterManager.personFilterWithQueryMapping narrows
 * Subscription/SubscriptionStatus/SubscriptionTopic searches by, for a patient-scoped caller
 * (see src/constants.js SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person and
 * src/fhir/patientFilterManager.js). Test fixtures must stamp this exact system on the
 * connection-identity extension/identifier so the patient-scope narrowing test can prove the
 * filter actually matches (or excludes) it.
 * @type {string}
 */
const CLIENT_PERSON_ID_SYSTEM = 'https://icanbwell.com/codes/client_person_id';

function makeSubscription (id, { clientPersonId }) {
    return {
        resourceType: 'Subscription',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        reason: 'Monitor connection',
        criteria: `SubscriptionTopic/${id}`,
        channel: { type: 'rest-hook', endpoint: 'https://example.com/hook' },
        extension: [{ id: 'client_person_id', url: CLIENT_PERSON_ID_SYSTEM, valueString: clientPersonId }]
    };
}

function makeSubscriptionStatus (id, { clientPersonId }) {
    return {
        resourceType: 'SubscriptionStatus',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        type: 'query-status',
        subscription: { reference: `Subscription/${id}` },
        topic: `https://example.com/SubscriptionTopic/${id}`,
        extension: [{ id: 'client_person_id', url: CLIENT_PERSON_ID_SYSTEM, valueString: clientPersonId }]
    };
}

function makeSubscriptionTopic (id, { clientPersonId }) {
    return {
        resourceType: 'SubscriptionTopic',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        url: `https://example.com/SubscriptionTopic/${id}`,
        identifier: [{ system: CLIENT_PERSON_ID_SYSTEM, value: clientPersonId }]
    };
}

function makeComposition (id, { patientId, authorOrgId }) {
    return {
        resourceType: 'Composition',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'final',
        type: { coding: [{ system: 'http://loinc.org', code: '11488-4', display: 'Consult note' }] },
        subject: { reference: `Patient/${patientId}` },
        date: '2024-01-01T00:00:00Z',
        author: [{ reference: `Organization/${authorOrgId}` }],
        title: 'Test Composition'
    };
}

function makeAppointment (id, { patientId }) {
    return {
        resourceType: 'Appointment',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'booked',
        participant: [{ actor: { reference: `Patient/${patientId}` }, status: 'accepted' }]
    };
}

function makeServiceRequest (id, { patientId, code }) {
    return {
        resourceType: 'ServiceRequest',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        intent: 'order',
        code: { coding: [{ system: 'http://snomed.info/sct', code, display: 'Test service request' }] },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeMedicationStatement (id, { patientId, code }) {
    return {
        resourceType: 'MedicationStatement',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        medicationCodeableConcept: {
            coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code, display: 'Test medication' }]
        },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeCareTeam (id, { patientId }) {
    return {
        resourceType: 'CareTeam',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeGoal (id, { patientId }) {
    return {
        resourceType: 'Goal',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        lifecycleStatus: 'active',
        description: { text: 'Improve blood pressure control' },
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeFamilyMemberHistory (id, { patientId }) {
    return {
        resourceType: 'FamilyMemberHistory',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'completed',
        patient: { reference: `Patient/${patientId}` },
        relationship: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'MTH', display: 'Mother' }]
        }
    };
}

function makeImmunizationRecommendation (id, { patientId }) {
    return {
        resourceType: 'ImmunizationRecommendation',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        patient: { reference: `Patient/${patientId}` },
        date: '2024-01-01T00:00:00Z',
        recommendation: [{
            forecastStatus: {
                coding: [{
                    system: 'http://terminology.hl7.org/CodeSystem/immunization-recommendation-status',
                    code: 'due',
                    display: 'Due'
                }]
            }
        }]
    };
}

function makeExplanationOfBenefit (id, { patientId, organizationId, coverageId }) {
    return {
        resourceType: 'ExplanationOfBenefit',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional', display: 'Professional' }] },
        use: 'claim',
        patient: { reference: `Patient/${patientId}` },
        created: '2024-01-01T00:00:00Z',
        insurer: { reference: `Organization/${organizationId}` },
        provider: { reference: `Organization/${organizationId}` },
        outcome: 'complete',
        insurance: [{ focal: true, coverage: { reference: `Coverage/${coverageId}` } }]
    };
}

function makeClaim (id, { patientId, organizationId, coverageId }) {
    return {
        resourceType: 'Claim',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'active',
        type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional', display: 'Professional' }] },
        use: 'claim',
        patient: { reference: `Patient/${patientId}` },
        created: '2024-01-01T00:00:00Z',
        provider: { reference: `Organization/${organizationId}` },
        priority: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/processpriority', code: 'normal', display: 'Normal' }] },
        insurance: [{ sequence: 1, focal: true, coverage: { reference: `Coverage/${coverageId}` } }]
    };
}

function makeQuestionnaireResponse (id, { patientId }) {
    return {
        resourceType: 'QuestionnaireResponse',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        status: 'completed',
        subject: { reference: `Patient/${patientId}` }
    };
}

function makeRelatedPerson (id, { patientId }) {
    return {
        resourceType: 'RelatedPerson',
        id,
        meta: { source: 'test', security: minimalSecurity() },
        patient: { reference: `Patient/${patientId}` }
    };
}

module.exports = {
    parseMcpRpcResponse,
    callMcpTool,
    bundleFromToolResult,
    idsInBundle,
    minimalSecurity,
    personUuid,
    patientScopedToken,
    makePatient,
    makeLocation,
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
};
