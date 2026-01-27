// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person1DuplicatePhoneNumber = require('./fixtures/Person/person1_duplicate_phone.json');
const person1UpdateIdentifier = require('./fixtures/Person/person1_update_identifier.json');
const person2UpdateIdentifier = require('./fixtures/Person/person2_update_identifier.json');
const bundleWithSameUuid = require('./fixtures/merge_bundle_with_same_uuid.json');

// expected
const expectedReplacedPersonResources = require('./fixtures/expected/expected_Replaced_Phone.json');
const expectedMergedPersonResources = require('./fixtures/expected/expected_merged_Phone.json');
const expectedPerson1MergedIdentifier = require('./fixtures/expected/expected_person1_merged_identifier.json');
const expectedPerson2MergedIdentifier = require('./fixtures/expected/expected_person2_merged_identifier.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

describe('Person Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('bulk replace with smartMerge=false simulates bulk PUT', async () => {
        const request = await createTestRequest();

        person1Resource[0].meta.source = 'bwell';

        // Step 1: Create initial resource
        const resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Step 2: Merge with a new version, it would add a new phone number
        const resp2 = await request
            .post('/4_0_0/Person/1/$merge')
            .send(person1DuplicatePhoneNumber)
            .set(getHeaders());
        expect(resp2).toHaveMergeResponse({ created: false });

        // Step 3: Verify the resource is updated
        const resp3 = await request.get('/4_0_0/Person/?_bundle=1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp3).toHaveResponse(expectedMergedPersonResources);

        // Step 4: Replace with a new version (simulate PUT)
        const resp4 = await request
            .post('/4_0_0/Person/1/$merge?smartMerge=false')
            .send(person1DuplicatePhoneNumber)
            .set(getHeaders());
        expect(resp4).toHaveMergeResponse({ created: false });

        // Step 5: Assert the resource is fully replaced (not merged)
        const resp5 = await request.get('/4_0_0/Person/?_bundle=1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp5).toHaveResponse(expectedReplacedPersonResources);

    });

    test('Merge updates all the identifier values except the sourceId and uuid', async () => {
        const request = await createTestRequest();

        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person1Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource
        resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person1UpdateIdentifier)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: false });

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/?_bundle=1')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson1MergedIdentifier);
    });

    test('Merge with no identifiers in the update request retains existing sourceId and uuid identifiers', async () => {
        const request = await createTestRequest();

        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2UpdateIdentifier)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource with no identifiers
        const person2UpdateNoIdentifier = { ...person2UpdateIdentifier };
        delete person2UpdateNoIdentifier.identifier;

        resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2UpdateNoIdentifier)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: false });

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/?_bundle=1')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson2MergedIdentifier);
    });

    test('Merge with only uuid as identifier retains existing sourceId identifier', async () => {
        const request = await createTestRequest();

        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2UpdateIdentifier)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource with only uuid as identifier
        const person2UpdateOnlyUuidIdentifier = { ...person2UpdateIdentifier };
        person2UpdateOnlyUuidIdentifier.identifier = person2UpdateOnlyUuidIdentifier.identifier.filter(
            id => id.system === IdentifierSystem.uuid
        );

        resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2UpdateOnlyUuidIdentifier)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: false });

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/?_bundle=1')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson2MergedIdentifier);
    });

    test('Merge with only sourceId as identifier retains existing uuid identifier', async () => {
        const request = await createTestRequest();

        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2UpdateIdentifier)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource with only sourceId as identifier
        const person2UpdateOnlySourceIdIdentifier = { ...person2UpdateIdentifier };
        person2UpdateOnlySourceIdIdentifier.identifier = person2UpdateOnlySourceIdIdentifier.identifier.filter(
            id => id.system === IdentifierSystem.sourceId
        );

        resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person2UpdateOnlySourceIdIdentifier)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: false });
        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/?_bundle=1')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson2MergedIdentifier);
    });

    test('Merge different resources with same uuid should return the return correct merge result entries', async () => {
        const request = await createTestRequest();

        // Create resources
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(bundleWithSameUuid)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([
            {
                created: true,
                updated: false
            },
            {
                created: true,
                updated: false
            },
            {
                created: true,
                updated: false
            }
        ]);

        // Update one resource and verify only that resource is updated
        const updatedBundle = bundleWithSameUuid;
        updatedBundle[1].gender = 'female';
        resp = await request
            .post('/4_0_0/Person/$merge')
            .send(updatedBundle)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        // check length of response should be 3
        expect(resp.body.length).toBe(3);

        expect(resp).toHaveMergeResponse([
            {
                created: false,
                updated: true
            },
            {
                created: false,
                updated: false
            },
            {
                created: false,
                updated: false
            }
        ]);
    });

});
