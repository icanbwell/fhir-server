const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { assertTooCostlyOperationOutcome } = require('../../group/groupTestHelpers');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const practitionerPayload = () => ({
    resourceType: 'Practitioner',
    active: true,
    gender: 'unknown',
    identifier: [
        { system: 'http://clienthealth.org', value: '4657' },
        { system: 'http://hl7.org/fhir/sid/us-npi', value: '1679033641' }
    ],
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
        ]
    },
    name: [{ family: 'NAJJAR  MD', given: ['SAMER S.'], use: 'usual' }],
    qualification: [
        {
            code: { coding: [{ code: 'MD', system: 'http://terminology.hl7.org/ValueSet/v2-2.7-030' }] },
            issuer: { reference: 'Organization/Stanford_Medical_School' },
            period: { start: '1960-01-01', end: '2021-12-11' }
        }
    ],
    telecom: [{ system: 'email', use: 'work', value: 'foo@foo.com' }]
});

const observationPayload = () => ({
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' }
        ]
    }
});

describe('Create with fast serializer', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('fast serializer is enabled by default', async () => {
        await createTestRequest();
        expect(getTestContainer().createOperation.useFastSerializer).toStrictEqual(true);
    });

    test('stored document has the same shape as before', async () => {
        const request = await createTestRequest();
        const postResp = await request
            .post('/4_0_0/Practitioner')
            .send(practitionerPayload())
            .set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        const id = postResp.headers['content-location'].split('/').splice(5, 1)[0];

        expect(postResp.body.id).toStrictEqual(id);
        expect(postResp.body.meta.versionId).toStrictEqual('1');
        expect(postResp.body.identifier.find((i) => i.system === IdentifierSystem.uuid).value).toStrictEqual(id);
        expect(postResp.body.identifier.find((i) => i.system === IdentifierSystem.sourceId).value).toStrictEqual(id);
        expect(postResp.body._uuid).toBeUndefined();

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('Practitioner_4_0_0').findOne({ _uuid: id });
        expect(stored.id).toStrictEqual(id);
        expect(stored._sourceAssigningAuthority).toStrictEqual('client');
        expect(stored.meta.versionId).toStrictEqual('1');
        expect(stored.meta.lastUpdated).toBeInstanceOf(Date);
        expect(stored.qualification[0].issuer).toStrictEqual({
            reference: 'Organization/Stanford_Medical_School',
            _uuid: 'Organization/' + generateUUIDv5('Stanford_Medical_School|client'),
            _sourceId: 'Organization/Stanford_Medical_School',
            _sourceAssigningAuthority: 'client'
        });
        expect(stored.qualification[0].period).toStrictEqual({ start: '1960-01-01', end: '2021-12-11' });

        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
        const history = await db.collection('Practitioner_4_0_0_History').findOne({ 'resource._uuid': id });
        expect(history.resource._uuid).toStrictEqual(id);
        expect(history.resource.id).toStrictEqual(id);

        const getResp = await request.get(`/4_0_0/Practitioner/${id}`).set(getHeaders());
        expect(getResp).toHaveStatusCode(200);
        expect(getResp.body.id).toStrictEqual(id);
        expect(getResp.body.name).toStrictEqual(postResp.body.name);
    });

    test('after-save handlers receive the saved resource with its internal fields', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const processor = container.postSaveProcessor;
        const originalAfterSave = processor.afterSaveAsync.bind(processor);
        const seen = [];
        processor.afterSaveAsync = async (args) => {
            seen.push({
                uuid: args.doc._uuid,
                sourceAssigningAuthority: args.doc._sourceAssigningAuthority,
                issuerUuid: args.doc.qualification?.[0]?.issuer?._uuid
            });
            return await originalAfterSave(args);
        };
        try {
            const postResp = await request
                .post('/4_0_0/Practitioner')
                .send(practitionerPayload())
                .set(getHeaders());
            expect(postResp).toHaveStatusCode(201);
            const id = postResp.headers['content-location'].split('/').splice(5, 1)[0];
            await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
            expect(seen).toStrictEqual([
                {
                    uuid: id,
                    sourceAssigningAuthority: 'client',
                    issuerUuid: 'Organization/' + generateUUIDv5('Stanford_Medical_School|client')
                }
            ]);
        } finally {
            processor.afterSaveAsync = originalAfterSave;
        }
    });

    test('client supplied meta.lastUpdated is ignored even when it is not a valid instant', async () => {
        const request = await createTestRequest();
        for (const lastUpdated of ['2021-06-01', '2021-06-01T10:00:00', 20210601]) {
            const payload = practitionerPayload();
            payload.meta.lastUpdated = lastUpdated;
            const postResp = await request.post('/4_0_0/Practitioner').send(payload).set(getHeaders());
            expect(postResp).toHaveStatusCode(201);
            expect(postResp.body.meta.lastUpdated).not.toStrictEqual(lastUpdated);
            expect(new Date(postResp.body.meta.lastUpdated).getFullYear()).toBeGreaterThan(2025);
        }
    });

    test('empty objects in optional fields are dropped', async () => {
        const request = await createTestRequest();
        const payload = practitionerPayload();
        payload.qualification[0].period = {};
        payload.telecom.push({});
        const postResp = await request.post('/4_0_0/Practitioner').send(payload).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        const id = postResp.headers['content-location'].split('/').splice(5, 1)[0];
        const getResp = await request.get(`/4_0_0/Practitioner/${id}`).set(getHeaders());
        expect(getResp.body.qualification[0].period).toBeUndefined();
        expect(getResp.body.telecom).toHaveLength(1);
    });

    test('empty object for a required field fails validation', async () => {
        const request = await createTestRequest();
        const payload = observationPayload();
        payload.code = {};
        const resp = await request.post('/4_0_0/Observation').send(payload).set(getHeaders());
        expect(resp).toHaveStatusCode(400);
        expect(resp.body.issue[0].details.text).toMatch(/code/);
    });

    test('invalid nested reference fails validation', async () => {
        const request = await createTestRequest();
        const payload = observationPayload();
        payload.subject = {
            reference: 'Patient/5b804b54-0ff5-5dc4-9e42-6ac45c6a5f69',
            identifier: { value: 'CE33W8M0H2C6HW9', assigner: { reference: 'invalidReference' } }
        };
        const resp = await request.post('/4_0_0/Observation').send(payload).set(getHeaders());
        expect(resp).toHaveStatusCode(400);
        expect(resp.body.issue[0].details.text).toStrictEqual(
            'subject.identifier.assigner.reference: invalidReference is an invalid reference'
        );
    });

    test('unknown field fails validation', async () => {
        const request = await createTestRequest();
        const payload = practitionerPayload();
        payload.notAFhirField = 'x';
        const resp = await request.post('/4_0_0/Practitioner').send(payload).set(getHeaders());
        expect(resp).toHaveStatusCode(400);
    });

    test('an oversized Group is rejected as too-costly before its member[] is schema validated', async () => {
        const savedExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        const savedPromotionLimit = process.env.GROUP_MEMBER_PROMOTION_LIMIT;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        process.env.GROUP_MEMBER_PROMOTION_LIMIT = '3';
        try {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/Group')
                .send({
                    resourceType: 'Group',
                    type: 'person',
                    actual: true,
                    notAFhirField: 'x',
                    meta: {
                        source: 'client',
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'client' },
                            { system: 'https://www.icanbwell.com/owner', code: 'client' }
                        ]
                    },
                    member: Array.from({ length: 4 }, (_, i) => ({ entity: { reference: `Patient/oversized-${i}` } }))
                })
                .set(getHeaders());
            assertTooCostlyOperationOutcome(resp, 4, 3);
        } finally {
            process.env.ENABLE_EXTENDED_GROUP = savedExtendedGroup;
            if (savedExtendedGroup === undefined) {
                delete process.env.ENABLE_EXTENDED_GROUP;
            }
            if (savedPromotionLimit === undefined) {
                delete process.env.GROUP_MEMBER_PROMOTION_LIMIT;
            } else {
                process.env.GROUP_MEMBER_PROMOTION_LIMIT = savedPromotionLimit;
            }
        }
    });

    test('uri fields named reference are not treated as References', async () => {
        const request = await createTestRequest();
        const resp = await request
            .post('/4_0_0/Immunization')
            .send({
                resourceType: 'Immunization',
                status: 'completed',
                vaccineCode: { coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '08' }] },
                patient: { reference: 'Patient/5b804b54-0ff5-5dc4-9e42-6ac45c6a5f69' },
                occurrenceDateTime: '2021-06-01',
                education: [{ documentType: 'VIS', reference: 'urn:oid:2.16.840.1.113883.6.1' }],
                meta: {
                    source: 'client',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                }
            })
            .set(getHeaders());
        expect(resp).toHaveStatusCode(201);
        expect(resp.body.education[0].reference).toStrictEqual('urn:oid:2.16.840.1.113883.6.1');
    });
});
