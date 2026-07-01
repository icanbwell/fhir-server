// Tests field-level pagination of Composition.section (_offset / _count) on the v2
// (federated) graph. See src/graphqlv2/resolvers/custom/composition.js.
const composition1Resource = require('./fixtures/composition1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

/**
 * Merge the fixture Composition and wait for async processing to finish.
 * @param {import('supertest').SuperTest} request
 */
async function seedComposition(request) {
    const resp = await request
        .post('/4_0_0/Composition/1/$merge')
        .send(composition1Resource)
        .set(getHeaders());
    // noinspection JSUnresolvedFunction
    expect(resp).toHaveMergeResponse({ created: true });

    const testContainer = getTestContainer();
    await testContainer.postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
    await testContainer.requestSpecificCache.clearAllAsync();
}

/**
 * @param {import('supertest').SuperTest} request
 * @param {string} query
 * @return {Promise<Object[]>} the section array of the first returned Composition
 */
async function querySections(request, query) {
    const resp = await request
        .post('/4_0_0/$graphqlv2')
        .send({ operationName: null, variables: {}, query })
        .set(getGraphQLHeaders())
        .expect(200);

    expect(resp.body.errors).toBeUndefined();
    return resp.body.data.compositions.entry[0].resource.section;
}

describe('GraphQL v2 Composition.section field-level pagination', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('returns the full list when no paging args are given', async () => {
        const request = await createTestRequest();
        await seedComposition(request);

        const sections = await querySections(
            request,
            `query { compositions { entry { resource { id section { id } } } } }`
        );
        expect(sections.map((s) => s.id)).toEqual(['section-0', 'section-1', 'section-2']);
    });

    test('_offset + _count returns a single page', async () => {
        const request = await createTestRequest();
        await seedComposition(request);

        const sections = await querySections(
            request,
            `query { compositions { entry { resource { id section(_offset: 1, _count: 1) { id title } } } } }`
        );
        expect(sections).toHaveLength(1);
        expect(sections[0].id).toEqual('section-1');
        expect(sections[0].title).toEqual('Section One');
    });

    test('_offset past the end returns an empty page', async () => {
        const request = await createTestRequest();
        await seedComposition(request);

        const sections = await querySections(
            request,
            `query { compositions { entry { resource { id section(_offset: 10, _count: 5) { id } } } } }`
        );
        expect(sections).toEqual([]);
    });
});
