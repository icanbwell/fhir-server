const { describe, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');
const deepcopy = require('deepcopy');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getCustomGraphQLHeaders,
    getHeadersWithCustomPayload,
    createTestRequest,
    fakeTimerBeforeEach,
    resetTimerAfterEach
} = require('../../common');

const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const activeConsent = require('./fixtures/Consent/activeConsent.json');
const compositionNoSensitive = require('./fixtures/Composition/compositionNoSensitive.json');
const compositionTopLevelSensitive = require('./fixtures/Composition/compositionTopLevelSensitive.json');
const compositionNestedSensitive = require('./fixtures/Composition/compositionNestedSensitive.json');
const compositionDeepSensitive = require('./fixtures/Composition/compositionDeepSensitive.json');
const compositionAllSensitive = require('./fixtures/Composition/compositionAllSensitive.json');

// Expected responses — REST
const expectedRestSearchDelegated = require('./fixtures/expected/rest_search_delegated.json');
const expectedRestSearchNonDelegated = require('./fixtures/expected/rest_search_non_delegated.json');
const expectedSearchByIdDelegatedNoSensitive = require('./fixtures/expected/rest_searchById_delegated_no_sensitive.json');
const expectedSearchByIdDelegatedTopLevel = require('./fixtures/expected/rest_searchById_delegated_top_level.json');
const expectedSearchByIdDelegatedNested = require('./fixtures/expected/rest_searchById_delegated_nested.json');
const expectedSearchByIdDelegatedDeep = require('./fixtures/expected/rest_searchById_delegated_deep.json');
const expectedSearchByIdDelegatedAllSensitive = require('./fixtures/expected/rest_searchById_delegated_all_sensitive.json');
const expectedSearchByIdNonDelegatedTopLevel = require('./fixtures/expected/rest_searchById_non_delegated_top_level.json');

// Expected responses — GraphQL
const expectedGraphqlV1Delegated = require('./fixtures/expected/graphqlV1_delegated.json');
const expectedGraphqlV1NonDelegated = require('./fixtures/expected/graphqlV1_non_delegated.json');
const expectedGraphqlV2Delegated = require('./fixtures/expected/graphqlV2_delegated.json');
const expectedGraphqlV2NonDelegated = require('./fixtures/expected/graphqlV2_non_delegated.json');
const expectedGraphqlV1PartialDelegated = require('./fixtures/expected/graphqlV1_partial_delegated.json');

// Expected responses — REST _elements
const expectedSearchElementsDelegated = require('./fixtures/expected/rest_search_elements_delegated.json');
const expectedSearchElementsNonDelegated = require('./fixtures/expected/rest_search_elements_non_delegated.json');

// Expected responses — $everything
const expectedEverythingDelegated = require('./fixtures/expected/everything_delegated.json');
const expectedEverythingNonDelegated = require('./fixtures/expected/everything_non_delegated.json');

// Expected responses — $graph
const expectedGraphDelegated = require('./fixtures/expected/graph_delegated.json');
const expectedGraphNonDelegated = require('./fixtures/expected/graph_non_delegated.json');

// Expected responses — _debug=1
const expectedSearchDebugDelegated = require('./fixtures/expected/rest_search_debug_delegated.json');

const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }

    get enableDelegatedAccessDetection () {
        return true;
    }
}

const delegatedPayload = {
    scope: 'patient/Composition.read patient/Patient.read access/*.read',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
    clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access',
    act: {
        reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
        sub: 'delegated-sub-123'
    }
};

const nonDelegatedPayload = {
    scope: 'patient/Composition.read patient/Patient.read access/*.read',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
    clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access'
    // no act claim — not a delegated user
};

describe('Composition Sensitive Section Filter E2E Tests', () => {
    const MOCK_DATE = new Date('2025-12-24T20:00:00.000Z');
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    afterAll(() => {
        cursorSpy.mockRestore();
    });

    beforeEach(async () => {
        await fakeTimerBeforeEach();
        jest.setSystemTime(MOCK_DATE);
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        await resetTimerAfterEach();
    });

    const seedData = async (request) => {
        const fixtures = [
            { url: '/4_0_0/Person/1/$merge?validate=true', body: topLevelPersonResource },
            { url: '/4_0_0/Person/1/$merge?validate=true', body: person1Resource },
            { url: '/4_0_0/Patient/1/$merge?validate=true', body: patient1Resource },
            { url: '/4_0_0/Consent/$merge?validate=true', body: activeConsent },
            { url: '/4_0_0/Composition/1/$merge?validate=true', body: compositionNoSensitive },
            { url: '/4_0_0/Composition/1/$merge?validate=true', body: compositionTopLevelSensitive },
            { url: '/4_0_0/Composition/1/$merge?validate=true', body: compositionNestedSensitive },
            { url: '/4_0_0/Composition/1/$merge?validate=true', body: compositionDeepSensitive }
        ];
        for (const { url, body } of fixtures) {
            const resp = await request.post(url).send(body).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
        }
    };

    // ─── REST SEARCH ─────────────────────────────────────────────────

    test('REST search: delegated user sees sensitive sections filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedRestSearchDelegated);
    });

    test('REST search: non-delegated user sees all sections unfiltered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/')
            .set(getHeadersWithCustomPayload(nonDelegatedPayload));

        expect(resp).toHaveResponse(expectedRestSearchNonDelegated);
    });

    // ─── REST SEARCH BY ID ───────────────────────────────────────────

    test('REST searchById: delegated user — no-sensitive composition is unchanged', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/comp-no-sensitive')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedSearchByIdDelegatedNoSensitive);
    });

    test('REST searchById: delegated user — top-level sensitive sections filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/comp-top-level-sensitive')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedSearchByIdDelegatedTopLevel);
    });

    test('REST searchById: delegated user — nested sensitive sections filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/comp-nested-sensitive')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedSearchByIdDelegatedNested);
    });

    test('REST searchById: delegated user — deep sensitive sections filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/comp-deep-sensitive')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedSearchByIdDelegatedDeep);
    });

    test('REST searchById: delegated user — all top-level sections classified, section property removed', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        // Seed the all-sensitive composition separately so it doesn't affect other tests
        const mergeResp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionAllSensitive)
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .get('/4_0_0/Composition/comp-all-sensitive')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedSearchByIdDelegatedAllSensitive);
    });

    test('REST searchById: non-delegated user sees all sections unfiltered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/comp-top-level-sensitive')
            .set(getHeadersWithCustomPayload(nonDelegatedPayload));

        expect(resp).toHaveResponse(expectedSearchByIdNonDelegatedTopLevel);
    });

    // ─── GRAPHQL V1 ──────────────────────────────────────────────────

    const graphqlV1Query = `{
        composition {
            entry {
                resource {
                    ... on Composition {
                        id
                        title
                        section {
                            id
                            title
                            code { coding { system code } }
                            section {
                                id
                                title
                                code { coding { system code } }
                                section {
                                    id
                                    title
                                    code { coding { system code } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }`;

    test('GraphQL v1: delegated user sees sensitive sections filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .post('/$graphql')
            .send({ operationName: null, variables: {}, query: graphqlV1Query })
            .set(getCustomGraphQLHeaders(delegatedPayload));

        expect(resp).toHaveGraphQLResponse(expectedGraphqlV1Delegated, 'composition');
    });

    test('GraphQL v1: non-delegated user sees all sections unfiltered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .post('/$graphql')
            .send({ operationName: null, variables: {}, query: graphqlV1Query })
            .set(getCustomGraphQLHeaders(nonDelegatedPayload));

        expect(resp).toHaveGraphQLResponse(expectedGraphqlV1NonDelegated, 'composition');
    });

    // ─── GRAPHQL V2 ──────────────────────────────────────────────────

    const graphqlV2Query = `{
        compositions {
            entry {
                resource {
                    ... on Composition {
                        id
                        title
                        section {
                            id
                            title
                            code { coding { system code } }
                            section {
                                id
                                title
                                code { coding { system code } }
                                section {
                                    id
                                    title
                                    code { coding { system code } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }`;

    test('GraphQL v2: delegated user sees sensitive sections filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({ operationName: null, variables: {}, query: graphqlV2Query })
            .set(getCustomGraphQLHeaders(delegatedPayload));

        expect(resp).toHaveGraphQLResponse(expectedGraphqlV2Delegated, 'compositions');
    });

    test('GraphQL v2: non-delegated user sees all sections unfiltered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({ operationName: null, variables: {}, query: graphqlV2Query })
            .set(getCustomGraphQLHeaders(nonDelegatedPayload));

        expect(resp).toHaveGraphQLResponse(expectedGraphqlV2NonDelegated, 'compositions');
    });

    // ─── REST SEARCH WITH _elements ────────────────────────────────────

    test('REST search with _elements: delegated user — sensitive sections still filtered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition?_id=comp-top-level-sensitive&_elements=id,section')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedSearchElementsDelegated);
    });

    test('REST search with _elements: non-delegated user — all sections present', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition?_id=comp-top-level-sensitive&_elements=id,section')
            .set(getHeadersWithCustomPayload(nonDelegatedPayload));

        expect(resp).toHaveResponse(expectedSearchElementsNonDelegated);
    });

    // ─── GRAPHQL PARTIAL FIELDS (PROJECTION) ─────────────────────────

    test('GraphQL v1 with partial fields: filtering still works when only title requested', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const partialQuery = `{
            composition(id: "comp-top-level-sensitive") {
                entry {
                    resource {
                        ... on Composition {
                            id
                            section {
                                title
                                code { coding { system code } }
                                section {
                                    title
                                    code { coding { system code } }
                                }
                            }
                        }
                    }
                }
            }
        }`;

        const resp = await request
            .post('/$graphql')
            .send({ operationName: null, variables: {}, query: partialQuery })
            .set(getCustomGraphQLHeaders(delegatedPayload));

        expect(resp).toHaveGraphQLResponse(expectedGraphqlV1PartialDelegated, 'composition');
    });

    // ─── $everything ─────────────────────────────────────────────────

    test('$everything: delegated user sees sensitive sections filtered across all compositions', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Patient/patient1/$everything')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedEverythingDelegated);
    });

    test('$everything: non-delegated user sees all sections unfiltered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Patient/patient1/$everything')
            .set(getHeadersWithCustomPayload(nonDelegatedPayload));

        expect(resp).toHaveResponse(expectedEverythingNonDelegated);
    });

    // ─── $graph ──────────────────────────────────────────────────────

    test('$graph: delegated user sees sensitive sections filtered across all compositions', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const graphDef = require('./fixtures/GraphDefinition/patientCompositionGraph.json');
        const resp = await request
            .post('/4_0_0/Patient/$graph?id=patient1')
            .send(graphDef)
            .set(getHeadersWithCustomPayload(delegatedPayload));

        expect(resp).toHaveResponse(expectedGraphDelegated);
    });

    test('$graph: non-delegated user sees all sections unfiltered', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const graphDef = require('./fixtures/GraphDefinition/patientCompositionGraph.json');
        const resp = await request
            .post('/4_0_0/Patient/$graph?id=patient1')
            .send(graphDef)
            .set(getHeadersWithCustomPayload(nonDelegatedPayload));

        expect(resp).toHaveResponse(expectedGraphNonDelegated);
    });

    // ─── REST SEARCH WITH _debug=1 (toHaveMongoQuery) ───────────────

    test('REST search with _debug=1: delegated user — verify mongo query and filtered response', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request);

        const resp = await request
            .get('/4_0_0/Composition/?_debug=1')
            .set(getHeadersWithCustomPayload(delegatedPayload));

        const expectedResp = deepcopy(expectedSearchDebugDelegated);
        expect(resp).toHaveMongoQuery(expectedResp);
        expect(resp).toHaveResponse(expectedResp);
    });
});
