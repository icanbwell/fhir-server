// practice
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerRoleResource = require('./fixtures/practitioner/practitionerRole.json');
const practitionerRoleDifferentSecurityTagResource = require('./fixtures/practitioner/practitionerRoleDifferentSecurityTag.json');
const organizationResource = require('./fixtures/practitioner/organization.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');

// expected
const expectedResource = require('./fixtures/expected/expected.json');
const expectedHashReferencesResource = require('./fixtures/expected/expected_hash_references.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');

const {findDuplicateResources} = require('../../../utils/list.util');
const {
    assertCompareBundles,
    assertStatusOk,
    assertResourceCount,
    assertMerge,
    assertResponse
} = require('../../fhirAsserts');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('Practitioner Graph Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph Contained Tests', () => {
        test('Graph contained works properly', async () => {
            const request = await createTestRequest();
            await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(assertStatusOk())
                .expect(assertResourceCount(0));

            await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(assertMerge({created: true}));

            await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders())
                .expect(assertMerge({created: true}));

            await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleDifferentSecurityTagResource)
                .set(getHeaders())
                .expect(assertMerge({created: true}));

            await request
                .post('/4_0_0/Organization/123456/$merge')
                .send(organizationResource)
                .set(getHeaders())
                .expect(assertMerge({created: true}));

            await request
                .post('/4_0_0/Practitioner/$graph?id=1679033641&contained=true')
                .send(graphDefinitionResource)
                .set(getHeaders())
                .expect(assertStatusOk())
                .expect(assertResponse(expectedResource));

            const resp = await request
                .post('/4_0_0/Practitioner/$graph?id=1679033641&contained=true&_hash_references=true')
                .send(graphDefinitionResource)
                .set(getHeaders())
                .expect(assertStatusOk())
                .expect(assertResponse(expectedHashReferencesResource));

            const body = resp.body;
            const expected = expectedHashReferencesResource;
            console.log('----- Received resources ----');
            console.log(`${body.entry.map(e => e.resource).map(a => `${a.resourceType}/${a.id}`)}`);
            console.log('----- End of Received resources ----');
            // verify there are no duplicate ids
            const duplicates = findDuplicateResources(
                body.entry.map(e => e.resource)
            );
            expect(duplicates.map(a => `${a.resourceType}/${a.id}`)).toStrictEqual([]);
            assertCompareBundles(body, expected);
        });
    });
});
