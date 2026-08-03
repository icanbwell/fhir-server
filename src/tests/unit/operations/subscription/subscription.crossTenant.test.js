/**
 * Cross-Tenant PHI Leakage Tests for Subscription/Notification System
 *
 * These tests assert CORRECT (secure) behavior and are expected to FAIL
 * against the current vulnerable code until the bugs are fixed.
 *
 * Vulnerabilities tested:
 * 1. INC-332: $everything Subscription/SubscriptionStatus/SubscriptionTopic custom queries
 *    match on source_patient_id + service_slug WITHOUT client_person_id tenant filter,
 *    allowing cross-tenant data leakage when patients are shared across tenants.
 * 2. SubscriptionStatus resources returned without tenant isolation when
 *    multiple tenants share the same source patient at the same health system.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { EverythingRelatedResourcesMapper } = require('../../../../operations/everything/everythingRelatedResourcesMapper');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');

describe('Subscription Cross-Tenant PHI Leakage', () => {
    let mapper;

    beforeEach(() => {
        mapper = new EverythingRelatedResourcesMapper();
    });

    describe('INC-332: $everything custom queries missing client_person_id filter', () => {
        /**
         * VULNERABILITY SCENARIO:
         * - Patient "john-doe-123" exists at health system "epic-hospital" (service_slug)
         * - Tenant A (person "person-tenant-a") has a Subscription for this patient
         * - Tenant B (person "person-tenant-b") also has a Subscription for the same patient
         * - When Tenant A calls $everything, the custom query matches on:
         *     source_patient_id = "john-doe-123" AND service_slug = "epic-hospital"
         * - This returns BOTH Tenant A's AND Tenant B's Subscriptions
         * - Tenant B's webhook URLs, notification preferences, and subscription
         *   details are leaked to Tenant A (PHI exposure via infrastructure metadata)
         */

        test('SubscriptionStatus customQuery MUST include client_person_id to prevent cross-tenant leakage', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            expect(subscriptionStatus).toBeDefined();
            expect(subscriptionStatus.customQuery).toBeDefined();

            // The query MUST filter by client_person_id to isolate tenants.
            // Current bug: only filters by source_patient_id + service_slug
            expect(subscriptionStatus.customQuery.query).toContain(
                'https://icanbwell.com/codes/client_person_id'
            );
        });

        test('Subscription customQuery MUST include client_person_id to prevent cross-tenant leakage', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            expect(subscription).toBeDefined();
            expect(subscription.customQuery).toBeDefined();

            // The query MUST filter by client_person_id to isolate tenants.
            // Current bug: only filters by source_patient_id + service_slug
            expect(subscription.customQuery.query).toContain(
                'https://icanbwell.com/codes/client_person_id'
            );
        });

        test('SubscriptionTopic customQuery MUST include client_person_id to prevent cross-tenant leakage', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionTopic = result.find(r => r.type === 'SubscriptionTopic');

            expect(subscriptionTopic).toBeDefined();
            expect(subscriptionTopic.customQuery).toBeDefined();

            // The query MUST filter by client_person_id to isolate tenants.
            // Current bug: only filters by source_patient_id + service_slug
            expect(subscriptionTopic.customQuery.query).toContain(
                'https://icanbwell.com/codes/client_person_id'
            );
        });

        test('SubscriptionStatus requiredValues MUST include _clientPersonId for tenant parameterization', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            // The requiredValues array determines which parent resource fields are substituted
            // into the query template. Without _clientPersonId (or equivalent person identifier),
            // the query cannot be parameterized with the requesting person's tenant context.
            expect(subscriptionStatus.customQuery.requiredValues).toEqual(
                expect.arrayContaining(['_clientPersonId'])
            );
        });

        test('Subscription requiredValues MUST include _clientPersonId for tenant parameterization', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            expect(subscription.customQuery.requiredValues).toEqual(
                expect.arrayContaining(['_clientPersonId'])
            );
        });

        test('SubscriptionTopic requiredValues MUST include _clientPersonId for tenant parameterization', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionTopic = result.find(r => r.type === 'SubscriptionTopic');

            expect(subscriptionTopic.customQuery.requiredValues).toEqual(
                expect.arrayContaining(['_clientPersonId'])
            );
        });
    });

    describe('INC-332: Cross-tenant query result isolation', () => {
        /**
         * These tests verify that the custom query structure, when evaluated against
         * a document set containing resources from multiple tenants, would only match
         * resources belonging to the requesting tenant.
         */

        test('SubscriptionStatus query template must have three-part $and filter (source_patient_id + service_slug + client_person_id)', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            const queryTemplate = JSON.parse(
                subscriptionStatus.customQuery.query
                    .replace(/{_sourceId}/g, 'test-patient')
                    .replace(/{_sourceAssigningAuthority}/g, 'test-slug')
                    .replace(/{_clientPersonId}/g, 'test-person')
            );

            // The $and array MUST have at least 3 conditions to properly isolate tenants:
            // 1. source_patient_id match
            // 2. service_slug match
            // 3. client_person_id match (THE MISSING FILTER)
            expect(queryTemplate.$and.length).toBeGreaterThanOrEqual(3);
        });

        test('Subscription query template must have three-part $and filter (source_patient_id + service_slug + client_person_id)', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            const queryTemplate = JSON.parse(
                subscription.customQuery.query
                    .replace(/{_sourceId}/g, 'test-patient')
                    .replace(/{_sourceAssigningAuthority}/g, 'test-slug')
                    .replace(/{_clientPersonId}/g, 'test-person')
            );

            // Must have 3 conditions to isolate tenants
            expect(queryTemplate.$and.length).toBeGreaterThanOrEqual(3);
        });

        test('SubscriptionTopic query template must have three-part $and filter', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionTopic = result.find(r => r.type === 'SubscriptionTopic');

            const queryTemplate = JSON.parse(
                subscriptionTopic.customQuery.query
                    .replace(/{_sourceId}/g, 'test-patient')
                    .replace(/{_sourceAssigningAuthority}/g, 'test-slug')
                    .replace(/{_clientPersonId}/g, 'test-person')
            );

            // Must have 3 conditions to isolate tenants
            expect(queryTemplate.$and.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('PatientFilterManager: Subscription person filter coverage', () => {
        let patientFilterManager;

        beforeEach(() => {
            patientFilterManager = new PatientFilterManager();
        });

        test('personFilterWithQueryMapping must define client_person_id filter for Subscription', () => {
            const filter = patientFilterManager.getPersonFilterQueryForResource({
                resourceType: 'Subscription'
            });

            expect(filter).toBeDefined();
            // The filter correctly uses client_person_id for person-scoped requests
            expect(filter).toContain('client_person_id');
        });

        test('personFilterWithQueryMapping must define client_person_id filter for SubscriptionStatus', () => {
            const filter = patientFilterManager.getPersonFilterQueryForResource({
                resourceType: 'SubscriptionStatus'
            });

            expect(filter).toBeDefined();
            expect(filter).toContain('client_person_id');
        });

        test('personFilterWithQueryMapping must define client_person_id filter for SubscriptionTopic', () => {
            const filter = patientFilterManager.getPersonFilterQueryForResource({
                resourceType: 'SubscriptionTopic'
            });

            expect(filter).toBeDefined();
            expect(filter).toContain('client_person_id');
        });

        /**
         * CRITICAL: The personFilterWithQueryMapping provides client_person_id filtering
         * for USER-scoped requests (isUser=true). However, the $everything custom query
         * operates INDEPENDENTLY of this filter for client/system-scoped requests.
         * The custom query in everythingRelatedResourcesMapper.js bypasses the
         * personFilterWithQueryMapping entirely, relying only on source_patient_id + service_slug.
         *
         * This means that while user-scoped calls are protected, system/client API calls
         * that use the $everything endpoint with the custom query path are NOT protected
         * by client_person_id filtering.
         */
        test('BUG: $everything custom query for SubscriptionStatus MUST be consistent with personFilterWithQueryMapping', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');
            const personFilter = patientFilterManager.getPersonFilterQueryForResource({
                resourceType: 'SubscriptionStatus'
            });

            // The person filter uses client_person_id - the custom query MUST also use it
            expect(personFilter).toContain('client_person_id');

            // BUG: The custom query does NOT include client_person_id
            // This creates an inconsistency where user-scoped requests are filtered
            // but the custom query path (used in $everything) is not
            expect(subscriptionStatus.customQuery.query).toContain('client_person_id');
        });
    });

    describe('Subscription webhook endpoint exposure via cross-tenant $everything', () => {
        /**
         * When a Subscription resource is leaked cross-tenant, the following PHI
         * and sensitive infrastructure data is exposed:
         * - channel.endpoint: The webhook URL (may contain API keys/tokens)
         * - channel.header: Custom HTTP headers (often contain auth tokens)
         * - criteria: What data the other tenant is interested in
         * - contact: Contact information of the subscribing party
         *
         * The custom query in the mapper directly controls what Subscription resources
         * are returned. Without client_person_id filtering, ALL subscriptions matching
         * the same source patient + service slug are returned regardless of tenant.
         */

        test('Subscription custom query must not return resources from other tenants sharing same source patient', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            // Simulate: two tenants share the same source_patient_id + service_slug
            // Tenant A: client_person_id = "person-aaa"
            // Tenant B: client_person_id = "person-bbb"
            //
            // The query, when populated for Tenant A, should NOT match Tenant B's resources.
            // This requires client_person_id to be part of the query filter.

            const queryStr = subscription.customQuery.query;

            // Verify the query template has a placeholder for client_person_id
            // so it can be parameterized per-tenant
            const hasClientPersonIdPlaceholder = queryStr.includes('{_clientPersonId}');
            const hasClientPersonIdLiteral = queryStr.includes('client_person_id');

            expect(hasClientPersonIdPlaceholder || hasClientPersonIdLiteral).toBe(true);
        });

        test('SubscriptionStatus custom query must not leak notification event details cross-tenant', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            // SubscriptionStatus contains:
            // - notificationEvent[].focus: references to resources that triggered notifications
            // - notificationEvent[].additionalContext: additional PHI context
            // - status: whether the subscription is active for the OTHER tenant
            // - error: error messages that may contain PHI from the other tenant's data

            const queryStr = subscriptionStatus.customQuery.query;

            const hasClientPersonIdPlaceholder = queryStr.includes('{_clientPersonId}');
            const hasClientPersonIdLiteral = queryStr.includes('client_person_id');

            expect(hasClientPersonIdPlaceholder || hasClientPersonIdLiteral).toBe(true);
        });
    });

    describe('SDK Subscription GraphQL resolver cross-tenant isolation', () => {
        /**
         * The SDK subscription resolver (sdkSubscription.js) searches by service_slug only:
         *   args.extension = `https://icanbwell.com/codes/service_slug|${service_slug}`
         *
         * While the normal FHIR search path adds security tags via constructQueryAsync,
         * the resolver doesn't explicitly add a client_person_id or tenant filter.
         * This relies entirely on the security tag mechanism being correctly applied.
         *
         * The $everything path custom query is MORE vulnerable because it builds
         * a raw MongoDB query that bypasses the normal search pipeline.
         */

        test('$everything custom query for Subscription must not rely solely on source_patient_id + service_slug', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            // Count the number of $elemMatch conditions in the $and array
            const queryObj = JSON.parse(
                subscription.customQuery.query
                    .replace(/{_sourceId}/g, 'test')
                    .replace(/{_sourceAssigningAuthority}/g, 'test')
                    .replace(/{_clientPersonId}/g, 'test')
            );

            // Must have more than just source_patient_id + service_slug
            // Currently has only 2 conditions; needs at least 3
            const conditionCount = queryObj.$and.length;
            expect(conditionCount).toBeGreaterThan(2);
        });
    });
});
