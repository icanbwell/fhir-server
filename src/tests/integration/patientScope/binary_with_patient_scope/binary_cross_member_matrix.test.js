// Cross-member and token-shape coverage for member-owned Binary (the cases the main suite lists as T12, T21,
// T22, T24, T25, plus the full "member B cannot reach member A's Binary" matrix).
//
// Where each cross-member path is covered (A uploaded the Binary; B holds a mixed token and a pure patient token):
//   by id                     binary_with_patient_scope.test.js T10 (mixed), T38 (pure); here too, on a real upload
//   search                    binary_with_patient_scope.test.js T11 (mixed), T38 (pure); here too
//   _history / vread          here (T12): 403 for every patient-scoped token
//   format=text/plain         here (T25)
//   Patient/Person $everything  binary_everything_graph.test.js (T13), cache: binary_everything_cache.test.js (B-7)
//   $graph                    binary_everything_graph.test.js (T14)
//   GraphQL v2                binary_graphql.test.js (T15/T16); GraphQL v1 has no attachment.resource field
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getHeadersWithCustomPayload,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');
const {
    READER_TOKENS,
    meta,
    memberClaims,
    createHelpers
} = require('./binaryScopeTestHelpers');

class MatrixConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }

    // T25: allow the plain-text read path
    get fhirNotesFullTextSearchConfigured () {
        return true;
    }
}

const SECRET_TEXT = 'derived text of the member Binary';

// stands in for the vector store; answers for every Binary so only the Binary read filter decides what is returned
class StubClinicalNoteTextRetriever {
    async getReassembledTextAsync () {
        return null;
    }

    async getReassembledTextForBinaryAsync () {
        return SECRET_TEXT;
    }
}

const newBinary = (extra = {}) => ({
    resourceType: 'Binary',
    id: 'ignored',
    meta,
    contentType: 'application/pdf',
    data: 'JVBERi0xLjQK',
    ...extra
});

describe('Binary with patient scope: cross-member matrix and token shapes', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.clearAllMocks();
    });

    const setup = async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MatrixConfigManager());
            c.register('clinicalNoteTextRetriever', () => new StubClinicalNoteTextRetriever());
            return c;
        });
        const helpers = createHelpers(request, requestId);
        const seeded = await helpers.seedSharedPatientWithOwnedBinary();
        return { request, helpers, ...seeded };
    };

    describe('member B cannot reach member A\'s uploaded Binary', () => {
        for (const { name, headers } of READER_TOKENS) {
            test(`by id and by search (${name})`, async () => {
                const { request, personA, personB, binaryId } = await setup();

                // positive control: the owner reads it with the same token shape
                const own = await request.get(`/4_0_0/Binary/${binaryId}`).set(headers(personA));
                expect(own).toHaveStatusCode(200);

                const byId = await request.get(`/4_0_0/Binary/${binaryId}`).set(headers(personB));
                expect(byId).toHaveStatusCode(404);

                const byIdParam = await request.get(`/4_0_0/Binary?_id=${binaryId}`).set(headers(personB));
                expect(byIdParam).toHaveStatusCode(200);
                expect(byIdParam.body.entry || []).toStrictEqual([]);

                const search = await request.get('/4_0_0/Binary').set(headers(personB));
                expect(search).toHaveStatusCode(200);
                expect((search.body.entry || []).map((e) => e.resource.id)).not.toContain(binaryId);
            });
        }
    });

    describe('T12: _history and _history/{vid} stay 403 for patient scopes', () => {
        for (const { name, headers } of READER_TOKENS) {
            for (const [label, path] of [
                ['instance history', (id) => `/4_0_0/Binary/${id}/_history`],
                ['vread', (id) => `/4_0_0/Binary/${id}/_history/1`],
                ['type history', () => '/4_0_0/Binary/_history']
            ]) {
                test(`${label} is forbidden for both the owner and another member (${name})`, async () => {
                    const { request, personA, personB, binaryId } = await setup();
                    for (const person of [personA, personB]) {
                        const resp = await request.get(path(binaryId)).set(headers(person));
                        expect(resp).toHaveStatusCode(403);
                    }
                });
            }
        }
    });

    describe('T25: Binary read with _format=text/plain', () => {
        for (const { name, headers } of READER_TOKENS) {
            test(`returns the derived text to the owner and nothing to another member (${name})`, async () => {
                const { request, personA, personB, binaryId } = await setup();

                const own = await request.get(`/4_0_0/Binary/${binaryId}?_format=text/plain`).set(headers(personA));
                expect(own).toHaveStatusCode(200);
                expect(own.headers['content-type']).toContain('text/plain');
                expect(own.text).toStrictEqual(SECRET_TEXT);

                const other = await request.get(`/4_0_0/Binary/${binaryId}?_format=text/plain`).set(headers(personB));
                expect(other).toHaveStatusCode(404);
                expect(other.text).not.toContain(SECRET_TEXT);
            });
        }
    });

    describe('T4: patient scope without a person id', () => {
        test('a patient/Binary.write token with no person claims cannot create a Binary', async () => {
            const { request } = await setup();
            // op-layer 403 for an empty personIdFromJwtToken is unit-tested in unit/operations/create/create.test.js
            const claimsWithoutPerson = { ...memberClaims('x', 'patient/Binary.write') };
            delete claimsWithoutPerson.clientFhirPersonId;
            delete claimsWithoutPerson.bwellFhirPersonId;
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary())
                .set(getHeadersWithCustomPayload(claimsWithoutPerson));
            expect(resp).toHaveStatusCode(401);
        });
    });

    describe('T21: a token for another tenant is still denied by the access-tag filter', () => {
        for (const scope of ['user/*.* access/other-tenant.*', 'system/*.* access/other-tenant.*']) {
            test(`${scope} cannot read member-owned Binary of tenant client1`, async () => {
                const { request, binaryId } = await setup();
                const headers = getHeaders(scope);

                const byId = await request.get(`/4_0_0/Binary/${binaryId}`).set(headers);
                expect(byId).toHaveStatusCode(404);
                const search = await request.get('/4_0_0/Binary').set(headers);
                expect(search).toHaveStatusCode(200);
                expect((search.body.entry || []).map((e) => e.resource.id)).not.toContain(binaryId);

                // control: a token for the owning tenant reads it
                const sameTenant = await request.get(`/4_0_0/Binary/${binaryId}`).set(getHeaders(scope.replace('other-tenant', 'client1')));
                expect(sameTenant).toHaveStatusCode(200);
            });
        }

        test('another tenant cannot create a Binary tagged for tenant client1', async () => {
            const { request } = await setup();
            const resp = await request.post('/4_0_0/Binary').send(newBinary()).set(getHeaders('user/*.* access/other-tenant.*'));
            expect(resp).toHaveStatusCode(403);
        });
    });

    describe('T22: mixed-scope create (patient and system/user scopes in one token)', () => {
        const create = (request, personUuid, scope) =>
            request
                .post('/4_0_0/Binary')
                .send(newBinary())
                .set(getHeadersWithCustomPayload(memberClaims(personUuid, scope)));

        test('patient/Binary.write alongside system/*.* is treated as a member create and stamped', async () => {
            const { request, personB } = await setup();
            const resp = await create(request, personB, 'patient/Binary.write system/*.*');
            expect(resp).toHaveStatusCode(201);
            expect(resp.body.securityContext.reference).toStrictEqual(`Patient/person.${personB}`);
        });

        test('system/*.* does not stand in for the patient create grant', async () => {
            const { request, personB } = await setup();
            for (const scope of ['patient/Condition.write system/*.*', 'patient/Binary.read system/*.*']) {
                const resp = await create(request, personB, scope);
                expect(resp).toHaveStatusCode(403);
            }
        });

        test('a mixed token cannot use the system write to supply someone else\'s securityContext', async () => {
            const { request, personA, personB } = await setup();
            const resp = await request
                .post('/4_0_0/Binary')
                .send(newBinary({ securityContext: { reference: `Patient/person.${personA}` } }))
                .set(getHeadersWithCustomPayload(memberClaims(personB, 'patient/Binary.write system/*.*')));
            expect(resp).toHaveStatusCode(403);
        });
    });

    describe('T24: user/ and access/ tokens without a patient scope are unchanged', () => {
        const userClaims = (personUuid) => memberClaims(personUuid, 'user/*.* access/*.*');

        test('create is not stamped and a member-owned Binary stays readable in-tenant (no person filter)', async () => {
            const { request, personA, personB, binaryId } = await setup();
            // person claims on the token must not switch the person filter on by themselves
            const headers = getHeadersWithCustomPayload(userClaims(personB));

            const created = await request.post('/4_0_0/Binary').send(newBinary()).set(headers);
            expect(created).toHaveStatusCode(201);
            expect(created.body.securityContext).toBeUndefined();

            const owned = await request.get(`/4_0_0/Binary/${binaryId}`).set(headers);
            expect(owned).toHaveStatusCode(200);
            expect(owned.body.securityContext.reference).toStrictEqual(`Patient/person.${personA}`);

            const search = await request.get('/4_0_0/Binary').set(headers);
            expect(search).toHaveStatusCode(200);
            expect((search.body.entry || []).map((e) => e.resource.id)).toEqual(
                expect.arrayContaining([binaryId, created.body.id])
            );
        });
    });
});
