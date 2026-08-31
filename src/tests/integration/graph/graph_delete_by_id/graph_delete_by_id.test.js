// claim
const claimResource = require('./fixtures/claim/explanation_of_benefits.json');
const practitionerResource = require('./fixtures/claim/practitioner.json');
const organizationResource = require('./fixtures/claim/organization.json');

// audit event skip
const taskResource = require('./fixtures/audit_event_skip/task.json');
const auditEventResource = require('./fixtures/audit_event_skip/audit_event.json');
const auditEventSkipGraphDefinition = require('./fixtures/audit_event_skip/graph_definition.json');
const expectedAuditEventSkipResponse = require('./fixtures/audit_event_skip/expected_delete_response.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');

// expected
const expectedResource_230916613368 = require('./fixtures/expected/expected-WPS-Claim-230916613368.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Claim Graph Delete By Id Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph Delete By Id - AuditEvent Skip Tests', () => {
        test('Graph delete skips AuditEvent resources referenced via relevantHistory', async () => {
            const request = await createTestRequest();

            // Create the AuditEvent resource
            let resp = await request
                .post('/4_0_0/AuditEvent/test-audit-event-1/$merge')
                .send(auditEventResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Create the Task resource that references the AuditEvent
            resp = await request
                .post('/4_0_0/Task/test-task-1/$merge')
                .send(taskResource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            // Verify both resources exist
            resp = await request
                .get('/4_0_0/Task/test-task-1')
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);

            resp = await request
                .get('/4_0_0/AuditEvent?_id=test-audit-event-1&date=ge2023-12-01&date=le2024-02-01')
                .set(getHeaders());
            expect(resp).toHaveResourceCount(1);

            // Delete the Task graph - AuditEvent should be skipped
            resp = await request
                .delete('/4_0_0/Task/test-task-1/$graph')
                .set(getHeaders())
                .send(auditEventSkipGraphDefinition);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventSkipResponse);

            // Verify Task is deleted
            resp = await request
                .get('/4_0_0/Task?_id=test-task-1')
                .set(getHeaders());
            expect(resp).toHaveResourceCount(0);

            // Verify AuditEvent still exists (was NOT deleted)
            resp = await request
                .get('/4_0_0/AuditEvent?_id=test-audit-event-1&date=ge2023-12-01&date=le2024-02-01')
                .set(getHeaders());
            expect(resp).toHaveResourceCount(1);
        });
    });

    describe('Graph Delete By Id Contained Tests', () => {
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
                .delete('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$graph')
                .set(getHeaders())
                .send(graphDefinitionResource);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource_230916613368);

            // verify that no resources are returned now
            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$graph')
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);
        });
    });
});
