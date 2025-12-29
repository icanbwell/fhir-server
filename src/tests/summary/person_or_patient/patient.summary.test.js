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

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscription2Resource = require('./fixtures/Subscription/subscription2.json');

const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionStatus2Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus2.json');

const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');
const subscriptionTopic2Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic2.json');


// expected
const expectedPatientBundle = require('./fixtures/expected/expected_patient_bundle.json');
const expectedProxyPatientBundle = require('./fixtures/expected/expected_proxy_patient_bundle.json');
const expectedPatientBundleUsingComposition = require('./fixtures/expected/expected_patient_bundle_using_composition.json');
const expectedPatientBundleLastUpdated = require('./fixtures/expected/expected_patient_bundle_last_updated.json');
const expectedPatientBundleLastUpdatedRange = require('./fixtures/expected/expected_patient_bundle_last_updated_range.json');
const expectedCompositionDivPath = `${__dirname}/fixtures/expected/expected_composition_div.html`;


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
        const streams = container.redisClient.streams;
        // Test without redis enabled
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(getHeaders());

        expect(Array.from(streams.keys())).toHaveLength(0);
        expect(resp).toHaveResourceCount(3);

        // Test with redis enabled
        process.env.ENABLE_REDIS = '1';
        process.env.ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION = '1';
        const redisReadSpy = jest.spyOn(container.redisStreamManager, 'readBundleEntriesFromStream');
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(getHeaders());

        expect(resp).toHaveResourceCount(3);
        let cacheKey = 'Patient:24a5930e-11b4-5525-b482-669174917044::Scopes:access/*.*,user/*.read,user/*.write::Summary';
        expect(streams.keys()).toContain(cacheKey);
        expect(streams.get(cacheKey)).toHaveLength(3);
        expect(resp.headers).toHaveProperty('x-cache', 'Miss');

        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(getHeaders());

        expect(resp).toHaveResourceCount(3);
        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(resp.headers).toHaveProperty('x-cache', 'Miss');

        process.env.ENABLE_REDIS_CACHE_READ_FOR_SUMMARY_OPERATION = '1';
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(getHeaders());

        expect(resp).toHaveResourceCount(3);
        expect(redisReadSpy).toHaveBeenCalled();
        redisReadSpy.mockClear();
        expect(resp.headers).toHaveProperty('x-cache', 'Hit');
        streams.clear();

        process.env.ENABLE_REDIS_CACHE_READ_FOR_SUMMARY_OPERATION = '1';
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary?_debug=true')
            .set(getHeaders());

        expect(resp).toHaveResourceCount(3);
        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(Array.from(streams.keys())).toHaveLength(0);
        redisReadSpy.mockClear();
        streams.clear();

        // test patient uuid case
        resp = await request
            .get('/4_0_0/Patient/24a5930e-11b4-5525-b482-669174917044/$summary')
            .set(getHeaders());

        expect(resp).toHaveResourceCount(3);
        expect(streams.keys()).toContain(cacheKey);
        expect(streams.get(cacheKey)).toHaveLength(3);
        streams.clear();

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
            .get('/4_0_0/Patient/24a5930e-11b4-5525-b482-669174917044/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(3);
        cacheKey = 'Patient:24a5930e-11b4-5525-b482-669174917044::Scopes:access/*.*,patient/*.*,user/*.*::Summary';
        expect(streams.keys()).toContain(cacheKey);
        expect(streams.get(cacheKey)).toHaveLength(3);
        streams.clear();

        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(3);
        cacheKey = 'Patient:24a5930e-11b4-5525-b482-669174917044::Scopes:access/*.*,patient/*.*,user/*.*::Summary';
        expect(streams.keys()).toContain(cacheKey);
        expect(streams.get(cacheKey)).toHaveLength(3);
        streams.clear();

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
            .get('/4_0_0/Patient/patient1/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(4);
        expect(Array.from(streams.keys())).toHaveLength(0);

        // Testing redis
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(patientHeader);

        expect(resp).toHaveResourceCount(4);
        redisReadSpy.mockClear();

        let headers = getHeaders();
        headers['Cache-Control'] = 'no-cache';
        resp = await request
            .get('/4_0_0/Patient/patient1/$summary')
            .set(headers);

        expect(redisReadSpy).not.toHaveBeenCalled();
        expect(resp.headers).toHaveProperty('x-cache', 'Miss')
        streams.clear();
        redisReadSpy.mockClear();

        process.env.ENABLE_REDIS = '0';
        process.env.ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION = '0';
    });
});
