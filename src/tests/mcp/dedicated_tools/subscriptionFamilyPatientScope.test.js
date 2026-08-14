'use strict';

/**
 * Subscription/SubscriptionStatus/SubscriptionTopic are the only dedicated MCP tools whose
 * patient-scope isolation does NOT come from the generic patient/subject-reference compartment
 * mechanism every other dedicated tool relies on (they have no patient/subject search parameter
 * at all) -- it comes from a b.well-specific mapping,
 * patientFilterManager.personFilterWithQueryMapping (src/fhir/patientFilterManager.js), which
 * narrows Subscription/SubscriptionStatus by a `client_person_id` extension and SubscriptionTopic
 * by a `client_person_id` identifier. Because this is a distinct, resource-specific isolation
 * mechanism in an area with a documented security-finding history (SEC-1582), it gets its own
 * explicit narrowing proof here rather than relying on the generic round-trip coverage in
 * dedicatedTools.test.js.
 *
 * Each caller's Person must have a real linked Patient: searchManager.js's patient-scope gate
 * (`allPatientIdsFromJwtToken.length === (personIdFromJwtToken ? 1 : 0)`) fails the whole search
 * closed whenever a Person resolves no real linked Patient, regardless of resourceType -- even
 * though Subscription-family narrowing itself only needs personIdFromJwtToken. Skipping the
 * Person/Patient fixtures makes every case here look like a narrowing failure when it is actually
 * this unrelated upstream guard.
 */
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const {
    callMcpTool,
    bundleFromToolResult,
    idsInBundle,
    personUuid,
    patientScopedToken,
    makePatient,
    makePerson,
    makeSubscription,
    makeSubscriptionTopic
} = require('../mcpTestHelpers');

describe('/mcp Subscription-family patient-scope narrowing', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    /**
     * Creates a Person (linked to a real Patient, so searchManager's patient-scope gate resolves a
     * non-empty patient-id list) and returns the personId's client_person_id value as stored on a
     * Subscription-family extension/identifier.
     * @param {import('supertest').Test} request
     * @param {string} personId
     * @returns {Promise<string>}
     */
    async function createPersonWithLinkedPatient (request, personId) {
        const patientId = `${personId}-patient`;
        let resp = await request
            .post(`/4_0_0/Patient/${patientId}/$merge?validate=true`)
            .send(makePatient(patientId, { family: 'ScopeTest', given: 'Sub', birthDate: '1990-01-01' }))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post(`/4_0_0/Person/${personId}/$merge?validate=true`)
            .send(makePerson(personId, [patientId]))
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        return personUuid(personId);
    }

    test('search_subscription only returns the caller\'s own connection (extension-based narrowing)', async () => {
        const request = await createTestRequest();
        const ownPersonId = 'sub-scope-own-person';
        const otherPersonId = 'sub-scope-other-person';
        const ownClientPersonId = await createPersonWithLinkedPatient(request, ownPersonId);
        const otherClientPersonId = await createPersonWithLinkedPatient(request, otherPersonId);

        for (const [id, clientPersonId] of [
            ['sub-scope-own-subscription', ownClientPersonId],
            ['sub-scope-other-subscription', otherClientPersonId]
        ]) {
            const resp = await request
                .post(`/4_0_0/Subscription/${id}/$merge?validate=true`)
                .send(makeSubscription(id, { clientPersonId }))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        }

        const { rpc } = await callMcpTool(request, patientScopedToken(ownPersonId), 'search_subscription', {});

        expect(rpc.result.isError).toBeUndefined();
        const ids = idsInBundle(bundleFromToolResult(rpc));
        expect(ids).toContain('sub-scope-own-subscription');
        expect(ids).not.toContain('sub-scope-other-subscription');
    });

    test('search_subscription_topic only returns the caller\'s own connection (identifier-based narrowing)', async () => {
        const request = await createTestRequest();
        const ownPersonId = 'topic-scope-own-person';
        const otherPersonId = 'topic-scope-other-person';
        const ownClientPersonId = await createPersonWithLinkedPatient(request, ownPersonId);
        const otherClientPersonId = await createPersonWithLinkedPatient(request, otherPersonId);

        for (const [id, clientPersonId] of [
            ['topic-scope-own-topic', ownClientPersonId],
            ['topic-scope-other-topic', otherClientPersonId]
        ]) {
            const resp = await request
                .post(`/4_0_0/SubscriptionTopic/${id}/$merge?validate=true`)
                .send(makeSubscriptionTopic(id, { clientPersonId }))
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        }

        const { rpc } = await callMcpTool(request, patientScopedToken(ownPersonId), 'search_subscription_topic', {});

        expect(rpc.result.isError).toBeUndefined();
        const ids = idsInBundle(bundleFromToolResult(rpc));
        expect(ids).toContain('topic-scope-own-topic');
        expect(ids).not.toContain('topic-scope-other-topic');
    });
});
