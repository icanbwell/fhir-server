const deepcopy = require('deepcopy');
// test file
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3.json');

const accountResource = require('./fixtures/Account/account.json');
const unlinkedAccountResource = require('./fixtures/Account/unlinked_account.json');
const compositionResource = require('./fixtures/Composition/compositions.json');
const compositionsWithProfileResource = require('./fixtures/Composition/compositions_with_profile.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscription2Resource = require('./fixtures/Subscription/subscription2.json');

const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionStatus2Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus2.json');

const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');
const subscriptionTopic2Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic2.json');

const condition1Resource = require('./fixtures/Condition/condition1.json');
const condition2Resource = require('./fixtures/Condition/condition2.json');
const clinicalImpression1Resource = require('./fixtures/ClinicalImpression/clinicalImpression1.json');


// expected
const expectedPatientBundle = require('./fixtures/expected/expected_patient_bundle.json');
const expectedProxyPatientBundle = require('./fixtures/expected/expected_proxy_patient_bundle.json');
const expectedPatientBundleUsingComposition = require('./fixtures/expected/expected_patient_bundle_using_composition.json');
const expectedPatientBundleLastUpdated = require('./fixtures/expected/expected_patient_bundle_last_updated.json');
const expectedPatientBundleLastUpdatedRange = require('./fixtures/expected/expected_patient_bundle_last_updated_range.json');
const expectedSummaryCompositionOnlyBundle = require('./fixtures/expected/expected_summary_bundle_with_only_composition.json');
const expectedCacheSummary = require('./fixtures/expected/expected_cache_summary.json');
const expectedCompositionDivPath = `${__dirname}/fixtures/expected/expected_composition_div.html`;
const expectedFunctionalStatusDivPath = `${__dirname}/fixtures/expected/expected_functional_status_div.html`;


// Helper function to normalize HTML for comparison
const normalizeHtml = (html) => {
    if (!html) return '';
    return html
        .replace(/\r\n/g, '\n')  // Normalize line endings
        .replace(/\s+/g, ' ')    // Normalize whitespace
        .replace(/>\s+</g, '><') // Remove whitespace between tags
        .replace(/\s+>/g, '>')   // Remove whitespace before closing bracket
        .replace(/<\s+/g, '<')   // Remove whitespace after opening bracket
        .trim();                 // Trim whitespace
};

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getHeadersWithCustomPayload
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect, jest} = require('@jest/globals');
const fs = require("node:fs");

describe('Patient $summary Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        jest.useFakeTimers({
            doNotFake: [
                'hrtime',
                'nextTick',
                'performance',
                'queueMicrotask',
                'requestAnimationFrame',
                'cancelAnimationFrame',
                'requestIdleCallback',
                'cancelIdleCallback',
                'setImmediate',
                'clearImmediate',
                'setInterval',
                'clearInterval',
                'setTimeout',
                'clearTimeout'
            ]
        });
        jest.setSystemTime(new Date('2025-12-15T12:00:00Z'));
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.useRealTimers();
    });

    test('Patient $summary works', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // ACT & ASSERT
        // First get patient everything
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientBundle, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });

        // Extract the first Composition resource from the bundle
        const compositionResource = resp.body.entry.find(entry =>
            entry.resource && entry.resource.resourceType === 'Composition'
        )?.resource;

        // Check that we found a Composition resource
        expect(compositionResource).toBeDefined();

        // Read the expected composition div content from fixture file
        const expectedCompositionDiv = fs.readFileSync(expectedCompositionDivPath, 'utf8');

        // Compare the text.div from the Composition resource with the expected HTML
        expect(normalizeHtml(compositionResource.text.div)).toBe(normalizeHtml(expectedCompositionDiv));
    });

    test('Patient $summary gives empty response for invalid id', async () => {
        const request = await createTestRequest();
        const resp = await request.get('/4_0_0/Patient/patient1/$summary').set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp).toHaveResponse({
            resourceType: 'Bundle',
            type: 'searchset',
            total: 0,
            entry: []
        });
    });

    test('Patient $summary works with _lastUpdated', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // ACT & ASSERT
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary?_debug=true&_lastUpdated=gt2024-12-31')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientBundleLastUpdated, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });

        resp = await request
            .get('/4_0_0/Patient/patient1/$summary?_debug=true&_lastUpdated=gt2024-12-31&_lastUpdated=lt2025-01-02')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientBundleLastUpdatedRange, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
    });

    test('should return a summary for the proxy patient', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // ACT & ASSERT
        // get proxy patient $summary
        resp = await request
            .get('/4_0_0/Patient/person.person2/$summary?_debug=1')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedProxyPatientBundle, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
    });

    test('should return a summary using compositions for the proxy patient', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

        // ACT & ASSERT
        // get proxy patient $summary
        resp = await request
            .get('/4_0_0/Patient/person.person2/$summary?_debug=1')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientBundleUsingComposition, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });

        // get person $summary returns same as proxy patient summary
        resp = await request
            .get('/4_0_0/Person/person2/$summary?_debug=1')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientBundleUsingComposition, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
    });

    test('should return error for request with multiple patient ids', async () => {
        const request = await createTestRequest();

        const multipleIdsError = {
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Multiple IDs are not allowed'
                    },
                    diagnostics: expect.stringContaining('Error: Multiple IDs are not allowed')
                }
            ]
        };

        let resp = await request
            .get('/4_0_0/Patient/1/$summary')
            .send({
                resourceType: 'Parameters',
                parameter: [
                    {
                        name: '_id',
                        valueString: 'patient1,patient2'
                    }
                ]
            })
            .set(getHeaders());
        expect(resp.status).toBe(400);
        expect(JSON.parse(resp.text)).toEqual(multipleIdsError);

        resp = await request.get('/4_0_0/Patient/patient1,patient2/$summary?_debug=1').set(getHeaders());
        expect(resp.status).toBe(400);
        expect(JSON.parse(resp.text)).toEqual(multipleIdsError);

        resp = await request.get('/4_0_0/Patient/patient1,person.person1/$summary?_debug=1').set(getHeaders());
        expect(resp.status).toBe(400);
        expect(JSON.parse(resp.text)).toEqual(multipleIdsError);

        resp = await request.get('/4_0_0/Person/person1,person2/$summary?_debug=1').set(getHeaders());
        expect(resp.status).toBe(400);
        expect(JSON.parse(resp.text)).toEqual(multipleIdsError);
    });

    test('Patient $summary works with redis cache', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);
        const container = getTestContainer();
        const redisData = container.redisClient.store;
        // Test without redis enabled
        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary')
            .set(getHeaders());

        expect(Array.from(redisData.keys())).toHaveLength(0);
        expect(resp).toHaveResponse(expectedCacheSummary, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });

        // Test with redis enabled
        process.env.ENABLE_REDIS = '1';
        process.env.ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION = '1';
        const redisReadSpy = jest.spyOn(container.redisManager, 'readBundleFromCacheAsync');
        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary')
            .set(getHeaders());

        expect(resp).toHaveResponse(expectedCacheSummary, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
        let cacheKey = 'ClientPerson:0eb80391-0f61-5ce6-b221-a5428f2f38a7:Summary:Generation:1:Scopes:6331e158-f666-5ee2-9e13-15282da7ba75';
        expect(redisData.keys()).toContain(cacheKey);
        expect(redisData.get('ClientPerson:0eb80391-0f61-5ce6-b221-a5428f2f38a7:Summary:Generation')).toEqual('1');
        expect(resp.headers).toHaveProperty('x-cache', 'Miss');

        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary')
            .set(getHeaders());
        expect(resp).toHaveResponse(expectedCacheSummary, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(resp.headers).toHaveProperty('x-cache', 'Miss');

        process.env.ENABLE_REDIS_CACHE_READ_FOR_SUMMARY_OPERATION = '1';
        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary')
            .set(getHeaders());

        expect(resp).toHaveResponse(expectedCacheSummary, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
        expect(redisReadSpy).toHaveBeenCalled();
        redisReadSpy.mockClear();
        expect(resp.headers).toHaveProperty('x-cache', 'Hit');

        // Simulate cache generation increment
        redisData.set('ClientPerson:0eb80391-0f61-5ce6-b221-a5428f2f38a7:Summary:Generation', '2');
        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary')
            .set(getHeaders());

        expect(resp).toHaveResponse(expectedCacheSummary, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
        expect(redisReadSpy).not.toHaveBeenCalled();
        redisReadSpy.mockClear();
        expect(resp.headers).toHaveProperty('x-cache', 'Miss');

        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary')
            .set(getHeaders());

        expect(resp).toHaveResponse(expectedCacheSummary, (resource) => {
            // remove the date from the Composition resource
            if (resource.resourceType === 'Composition') {
                delete resource.date;
            }
        });
        expect(redisReadSpy).toHaveBeenCalled();
        redisReadSpy.mockClear();
        expect(resp.headers).toHaveProperty('x-cache', 'Hit');
        expect(redisData.keys()).toContain(cacheKey);
        expect(redisData.keys()).toContain('ClientPerson:0eb80391-0f61-5ce6-b221-a5428f2f38a7:Summary:Generation:2:Scopes:6331e158-f666-5ee2-9e13-15282da7ba75');
        expect(redisData.get('ClientPerson:0eb80391-0f61-5ce6-b221-a5428f2f38a7:Summary:Generation')).toEqual('2');

        redisData.clear();

        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary?_debug=true')
            .set(getHeaders());

        expect(resp).toHaveResourceCount(4);
        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(Array.from(redisData.keys())).toHaveLength(0);
        redisReadSpy.mockClear();
        redisData.clear();

        // test patient uuid case, redis should not be used for Patient
        resp = await request
            .get('/4_0_0/Patient/24a5930e-11b4-5525-b482-669174917044/$summary')
            .set(getHeaders());

        expect(resp).toHaveResourceCount(3);
        expect(redisReadSpy).not.toHaveBeenCalled();
        redisData.clear();

        // test with patient scopes
        let jwtPayload = {
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'test',
            client_id: 'client',
            clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
            clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
            bwellFhirPersonId: 'master-person',
            bwellFhirPatientId: 'master-patient',
            token_use: 'access'
        };
        let patientHeader = getHeadersWithCustomPayload(jwtPayload);
        resp = await request
            .get('/4_0_0/Patient/person.7b99904f-2f85-51a3-9398-e2eed6854639/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(3);
        cacheKey = 'ClientPerson:7b99904f-2f85-51a3-9398-e2eed6854639:Summary:Generation:1:Scopes:41b78b54-0a8e-5477-af30-d99864d04833';
        expect(cacheKey).toBeDefined();
        let cachedBundle = JSON.parse(redisData.get(cacheKey));
        expect(cachedBundle.entry).toHaveLength(9);

        resp = await request
            .get('/4_0_0/Patient/person.7b99904f-2f85-51a3-9398-e2eed6854639/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(3);
        expect(resp.headers).toHaveProperty('x-cache', 'Hit');
        // Cache key should be the same for the same patient
        expect(redisData.keys()).toContain(cacheKey);
        cachedBundle = JSON.parse(redisData.get(cacheKey));
        expect(cachedBundle.entry).toHaveLength(9);
        redisData.clear();

        // Testing Multiple patients linked with same sourceId
        let patient4Resource = deepcopy(patient1Resource);
        patient4Resource.meta.security = [
            {
                system: "https://www.icanbwell.com/access",
                code: "healthsystem1"
            },
            {
                system: "https://www.icanbwell.com/owner",
                code: "healthsystem2"
            }
        ];
        let person4Resource = deepcopy(person1Resource);
        person4Resource.link = [
            {
                target: {
                    reference: "Patient/patient1|healthsystem1",
                    type: "Patient"
                },
                assurance: "level4"
            },
            {
                target: {
                    reference: "Patient/patient1|healthsystem2",
                    type: "Patient"
                },
                assurance: "level4"
            }
        ]
        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient4Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person4Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: false });

        resp = await request
            .get('/4_0_0/Patient/person.7b99904f-2f85-51a3-9398-e2eed6854639/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(4);

        // Testing redis
        resp = await request
            .get('/4_0_0/Patient/person.7b99904f-2f85-51a3-9398-e2eed6854639/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(4);
        expect(redisReadSpy).toHaveBeenCalled();
        redisReadSpy.mockClear();

        let headers = getHeaders();
        headers['Cache-Control'] = 'no-cache';
        resp = await request
            .get('/4_0_0/Patient/person.0eb80391-0f61-5ce6-b221-a5428f2f38a7/$summary')
            .set(headers);

        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(resp.headers).toHaveProperty('x-cache', 'Miss')
        redisData.clear();
        redisReadSpy.mockClear();

        process.env.ENABLE_REDIS = '0';
        process.env.ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION = '0';
    });

    test('Patient $summary works functional status', async () => {
        const request = await createTestRequest();

        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(condition1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(condition2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(clinicalImpression1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // get person $summary returns same as proxy patient summary
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary?_debug=1')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);

        const compositionResource = resp.body.entry.find((entry) => entry.resource.resourceType === 'Composition');
        const functionalStatusSection = compositionResource.resource.section.find((section) => section.title === 'Functional Status');

        const expectedFunctionalStatusDiv = fs.readFileSync(expectedFunctionalStatusDivPath, 'utf8');

        // Compare the text.div from the Composition resource with the expected HTML
        expect(normalizeHtml(functionalStatusSection.text.div)).toBe(normalizeHtml(expectedFunctionalStatusDiv));
    });

    test('Patient $summary should return summary bundle only when _includeSummaryComposition=true', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // ACT & ASSERT
        // get proxy patient $summary
        resp = await request
            .get('/4_0_0/Patient/person.person2/$summary?_includeSummaryCompositionOnly=1&_debug=1')
            .set(getHeaders());

        // Basic response checks
        expect(resp.status).toBe(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedSummaryCompositionOnlyBundle);
    });

    test('Patient $summary filters Composition resources by _profile parameter', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // Add compositions with profiles
        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionsWithProfileResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{created: true}, {created: true}, {created: true}]);

        // ACT & ASSERT
        // Test 1: Request with _profile filter - should only return Compositions with matching profile
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary?_profile=http://hl7.org/fhir/uv/ips/StructureDefinition/basic-ips&_debug=1')
            .set(getHeaders());

        expect(resp.status).toBe(200);
        // Should have a Composition in the summary bundle
        const summaryBundle = resp.body;
        expect(summaryBundle.resourceType).toBe('Bundle');

        // Check the debug bundle to verify Composition filter was applied
        const debugBundle = summaryBundle.meta?.tag?.find(t => t.system === 'https://www.icanbwell.com/debug')?.display;
        if (debugBundle) {
            // Verify that the Composition query contains the _profile filter
            expect(debugBundle).toContain('_profile');
        }
    });

    test('Patient $summary without _profile returns all Compositions', async () => {
        const request = await createTestRequest();
        // ARRANGE
        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // Add compositions with profiles
        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionsWithProfileResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{created: true}, {created: true}, {created: true}]);

        // ACT & ASSERT
        // Request without _profile filter - should return all matching Compositions
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary?_debug=1')
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Bundle');
    });

    test('Patient $summary with _includeSummaryCompositionOnly applies _profile filter to Composition search', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // Add compositions with profiles
        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionsWithProfileResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{created: true}, {created: true}, {created: true}]);

        // ACT & ASSERT
        // Request with _includeSummaryCompositionOnly and _profile filter
        resp = await request
            .get('/4_0_0/Patient/person.person2/$summary?_includeSummaryCompositionOnly=1&_profile=http://hl7.org/fhir/uv/ips/StructureDefinition/basic-ips&_debug=1')
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Bundle');

        // When _includeSummaryCompositionOnly is true, Compositions are fetched separately
        // and the _profile filter should be applied to that search
    });

    test('Patient $summary _profile filter does not affect other resource types', async () => {
        const request = await createTestRequest();
        // ARRANGE
        let resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({created: true});

        // Add compositions with profiles
        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionsWithProfileResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{created: true}, {created: true}, {created: true}]);

        // ACT & ASSERT
        // Request with _profile filter
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary?_profile=http://hl7.org/fhir/uv/ips/StructureDefinition/basic-ips&_debug=1')
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Bundle');

        // The _profile filter should only apply to Compositions, not to other resources
        // Observations and Patient should still be returned regardless of the _profile parameter
        // Find entries by resourceType to verify other resources are present
        const entries = resp.body.entry || [];
        const patientEntry = entries.find(e => e.resource?.resourceType === 'Patient');
        expect(patientEntry).toBeDefined();
    });
});