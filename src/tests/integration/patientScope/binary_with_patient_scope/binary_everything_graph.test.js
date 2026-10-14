// T13 / T14 / T26: Binary reached through $everything and $graph must honour the person securityContext filter.
//
// A Binary reaches $everything only through a clinical DocumentReference whose content.attachment.url points at
// it (nonClinicalResourceExtractor). $graph can only traverse FHIR Reference fields, and
// DocumentReference.content.attachment.url is a plain uri, so a DocumentReference -> Binary $graph link does not
// exist; the Binary-reaching $graph links that do exist are Communication.payload.contentReference (-> Binary; Provenance
// is not patient-filtered so it cannot be a patient-scoped start resource) and Binary.securityContext (-> Patient,
// with the Binary as the start resource), and both are covered here.
//
// Every case runs with both a mixed token and a pure patient token.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeadersWithCustomPayload,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');
const {
    READER_TOKENS,
    PURE_PATIENT_SCOPE,
    SHARED_PATIENT,
    meta,
    memberClaims,
    createHelpers,
    binaryIdsIn
} = require('./binaryScopeTestHelpers');

class EverythingConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }
}

const headersFor = (personUuid, scope) => getHeadersWithCustomPayload(memberClaims(personUuid, scope));
// the pure token additionally needs Communication for the $graph start resource
const graphScope = (scope) => (scope === PURE_PATIENT_SCOPE ? `${scope} patient/Communication.read` : scope);

describe('Binary with patient scope: $everything and $graph', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const setup = async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new EverythingConfigManager());
            return c;
        });
        const helpers = createHelpers(request, requestId);
        const seeded = await helpers.seedSharedPatientWithOwnedBinary();
        return { request, helpers, ...seeded };
    };

    describe('T13: $everything', () => {
        for (const { name, scope } of READER_TOKENS) {
            test(`Patient/$everything includes the Binary for the owner and omits it for another member (${name})`, async () => {
                const { request, personA, personB, binaryId } = await setup();
                const url = `/4_0_0/Patient/${SHARED_PATIENT}/$everything`;

                const respA = await request.get(url).set(headersFor(personA, scope));
                expect(respA).toHaveStatusCode(200);
                expect(binaryIdsIn(respA.body)).toStrictEqual([binaryId]);

                const respB = await request.get(url).set(headersFor(personB, scope));
                expect(respB).toHaveStatusCode(200);
                // the DocumentReference is still returned: only the Binary behind it is hidden
                expect((respB.body.entry || []).some((e) => e.resource.resourceType === 'DocumentReference')).toBe(true);
                expect(binaryIdsIn(respB.body)).toStrictEqual([]);
            });

            test(`Person/$everything includes the Binary for the owner and omits it for another member (${name})`, async () => {
                const { request, personA, personB, binaryId } = await setup();

                const respA = await request.get(`/4_0_0/Person/${personA}/$everything`).set(headersFor(personA, scope));
                expect(respA).toHaveStatusCode(200);
                expect(binaryIdsIn(respA.body)).toStrictEqual([binaryId]);

                const respB = await request.get(`/4_0_0/Person/${personB}/$everything`).set(headersFor(personB, scope));
                expect(respB).toHaveStatusCode(200);
                expect((respB.body.entry || []).some((e) => e.resource.resourceType === 'DocumentReference')).toBe(true);
                expect(binaryIdsIn(respB.body)).toStrictEqual([]);
            });

            test(`B's own DocumentReference pointing at A's Binary still does not return A's Binary (${name})`, async () => {
                const { request, helpers, personB, binaryId } = await setup();
                await helpers.mergeDocumentReference('doc-b', binaryId);
                const resp = await request
                    .get(`/4_0_0/Patient/${SHARED_PATIENT}/$everything`)
                    .set(headersFor(personB, scope));
                expect(resp).toHaveStatusCode(200);
                expect(binaryIdsIn(resp.body)).toStrictEqual([]);
            });
        }
    });

    describe('T14: $graph', () => {
        const communicationGraph = {
            resourceType: 'GraphDefinition',
            id: 'communication-binary',
            name: 'communication-binary',
            status: 'active',
            start: 'Communication',
            link: [{ path: 'payload.contentReference', target: [{ type: 'Binary' }] }]
        };
        const binaryToPatientGraph = {
            resourceType: 'GraphDefinition',
            id: 'binary-patient',
            name: 'binary-patient',
            status: 'active',
            start: 'Binary',
            link: [{ path: 'securityContext', target: [{ type: 'Patient' }] }]
        };

        const seedCommunication = async (helpers, binaryId) =>
            helpers.merge('Communication', {
                resourceType: 'Communication',
                id: 'comm-1',
                meta,
                status: 'completed',
                subject: { reference: `Patient/${SHARED_PATIENT}` },
                payload: [{ contentReference: { reference: `Binary/${binaryId}` } }]
            });

        for (const { name, scope } of READER_TOKENS) {
            test(`Communication -> Binary graph returns the Binary for the owner and omits it for another member (${name})`, async () => {
                const { request, helpers, personA, personB, binaryId } = await setup();
                await seedCommunication(helpers, binaryId);
                const url = '/4_0_0/Communication/comm-1/$graph?contained=false';

                const respA = await request.post(url).send(communicationGraph).set(headersFor(personA, graphScope(scope)));
                expect(respA).toHaveStatusCode(200);
                expect(binaryIdsIn(respA.body)).toStrictEqual([binaryId]);

                const respB = await request.post(url).send(communicationGraph).set(headersFor(personB, graphScope(scope)));
                expect(respB).toHaveStatusCode(200);
                expect(binaryIdsIn(respB.body)).toStrictEqual([]);
            });

            test(`a Binary-start graph does not return another member's Binary or the Patient behind it (${name})`, async () => {
                const { request, personA, personB, binaryId } = await setup();
                const url = `/4_0_0/Binary/${binaryId}/$graph`;

                const respA = await request.post(url).send(binaryToPatientGraph).set(headersFor(personA, scope));
                expect(respA).toHaveStatusCode(200);
                expect(binaryIdsIn(respA.body)).toStrictEqual([binaryId]);

                const respB = await request.post(url).send(binaryToPatientGraph).set(headersFor(personB, scope));
                expect(binaryIdsIn(respB.body)).toStrictEqual([]);
                expect(respB.body.entry || []).toStrictEqual([]);
            });
        }
    });

    describe('T26: cache short-circuit paths', () => {
        // $everything: covered by binary_everything_cache.test.js (B-7, the response cache is keyed per caller person).
        test('$graph has no response cache to short-circuit (nothing under operations/graph reads or writes one)', () => {
            const fs = require('fs');
            const path = require('path');
            const dir = path.resolve(__dirname, '../../../../operations/graph');
            const hits = fs
                .readdirSync(dir)
                .filter((f) => f.endsWith('.js'))
                .filter((f) => /redis|cacheKey|readFromCache|writeToCache|CacheReader|CacheWriter/i.test(
                    fs.readFileSync(path.join(dir, f), 'utf8')
                ));
            expect(hits).toStrictEqual([]);
        });
    });
});
