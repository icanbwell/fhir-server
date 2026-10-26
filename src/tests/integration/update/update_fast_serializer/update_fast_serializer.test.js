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

describe('Update with fast serializer', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const createPractitioner = async (request) => {
        const postResp = await request.post('/4_0_0/Practitioner').send(practitionerPayload()).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
        return postResp.body.id;
    };

    test('fast serializer is enabled by default', async () => {
        await createTestRequest();
        expect(getTestContainer().updateOperation.useFastSerializer).toStrictEqual(true);
    });

    test('updated document and history have the same shape as before', async () => {
        const request = await createTestRequest();
        const id = await createPractitioner(request);

        const payload = practitionerPayload();
        payload.id = id;
        payload.name = [{ family: 'UPDATED', given: ['SAMER S.'], use: 'usual' }];
        const putResp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
        expect(putResp).toHaveStatusCode(200);
        expect(putResp.body.id).toStrictEqual(id);
        expect(putResp.body.meta.versionId).toStrictEqual('2');
        expect(putResp.body.name[0].family).toStrictEqual('UPDATED');
        expect(putResp.body._uuid).toBeUndefined();
        expect(putResp.body._sourceAssigningAuthority).toBeUndefined();

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('Practitioner_4_0_0').findOne({ _uuid: id });
        expect(stored.id).toStrictEqual(id);
        expect(stored._sourceAssigningAuthority).toStrictEqual('client');
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.meta.lastUpdated).toBeInstanceOf(Date);
        expect(stored.name[0].family).toStrictEqual('UPDATED');
        expect(stored.qualification[0].issuer).toStrictEqual({
            reference: 'Organization/Stanford_Medical_School',
            _uuid: 'Organization/' + generateUUIDv5('Stanford_Medical_School|client'),
            _sourceId: 'Organization/Stanford_Medical_School',
            _sourceAssigningAuthority: 'client'
        });
        expect(stored.qualification[0].period).toStrictEqual({ start: '1960-01-01', end: '2021-12-11' });

        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
        const readHistory = async () => await db
            .collection('Practitioner_4_0_0_History')
            .find({ 'resource._uuid': id })
            .sort({ 'resource.meta.versionId': 1 })
            .toArray();
        let history = await readHistory();
        for (let attempt = 0; attempt < 20 && history.length < 2; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            history = await readHistory();
        }
        expect(history.map((h) => h.resource.meta.versionId)).toStrictEqual(['1', '2']);
        expect(history[1].resource.name[0].family).toStrictEqual('UPDATED');
        expect(history[1].resource._uuid).toStrictEqual(id);

        const getResp = await request.get(`/4_0_0/Practitioner/${id}`).set(getHeaders());
        expect(getResp).toHaveStatusCode(200);
        expect(getResp.body.name[0].family).toStrictEqual('UPDATED');
    });

    test('history records the patch operations as the client sent them', async () => {
        const request = await createTestRequest();
        const id = await createPractitioner(request);

        const payload = practitionerPayload();
        payload.id = id;
        payload.qualification.push({
            code: { coding: [{ code: 'DO', system: 'http://terminology.hl7.org/ValueSet/v2-2.7-030' }] },
            issuer: { reference: 'Organization/Other_Medical_School' }
        });
        const putResp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
        expect(putResp).toHaveStatusCode(200);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const readHistoryRow = async () => await db
            .collection('Practitioner_4_0_0_History')
            .findOne({ 'resource._uuid': id, 'resource.meta.versionId': '2' });
        let row = await readHistoryRow();
        for (let attempt = 0; attempt < 20 && !row; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            row = await readHistoryRow();
        }
        const operations = row.response.outcome.issue.map((i) => JSON.parse(i.diagnostics));
        expect(operations).toHaveLength(1);
        expect(operations[0]).toMatchObject({
            op: 'add',
            path: '/qualification/1',
            value: { issuer: { reference: 'Organization/Other_Medical_School' } }
        });
        expect(JSON.stringify(operations)).not.toMatch(/"_(uuid|access|sourceId|sourceAssigningAuthority)"/);
    });

    test('after-save handlers receive the saved resource with its internal fields', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const id = await createPractitioner(request);
        await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

        const processor = container.postSaveProcessor;
        const originalAfterSave = processor.afterSaveAsync.bind(processor);
        const seen = [];
        processor.afterSaveAsync = async (args) => {
            seen.push({
                eventType: args.eventType,
                uuid: args.doc._uuid,
                sourceAssigningAuthority: args.doc._sourceAssigningAuthority,
                issuerUuid: args.doc.qualification?.[0]?.issuer?._uuid
            });
            return await originalAfterSave(args);
        };
        try {
            const payload = practitionerPayload();
            payload.id = id;
            payload.active = false;
            const putResp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
            expect(putResp).toHaveStatusCode(200);
            await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
            expect(seen).toStrictEqual([
                {
                    eventType: 'U',
                    uuid: id,
                    sourceAssigningAuthority: 'client',
                    issuerUuid: 'Organization/' + generateUUIDv5('Stanford_Medical_School|client')
                }
            ]);
        } finally {
            processor.afterSaveAsync = originalAfterSave;
        }
    });

    test('put of an unchanged resource does not create a new version', async () => {
        const request = await createTestRequest();
        const id = await createPractitioner(request);

        const payload = practitionerPayload();
        payload.id = id;
        const putResp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
        expect(putResp).toHaveStatusCode(200);
        expect(putResp.body.meta.versionId).toStrictEqual('1');
        expect(putResp.body.id).toStrictEqual(id);
        expect(putResp.body._uuid).toBeUndefined();
    });

    test('put to an id that does not exist creates the resource', async () => {
        const request = await createTestRequest();
        const payload = practitionerPayload();
        payload.id = 'created-by-put';
        const putResp = await request.put('/4_0_0/Practitioner/created-by-put').send(payload).set(getHeaders());
        expect(putResp).toHaveStatusCode(201);
        expect(putResp.body.id).toStrictEqual('created-by-put');
        expect(putResp.body.meta.versionId).toStrictEqual('1');

        const uuid = generateUUIDv5('created-by-put|client');
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('Practitioner_4_0_0').findOne({ _uuid: uuid });
        expect(stored.id).toStrictEqual('created-by-put');
        expect(stored._sourceAssigningAuthority).toStrictEqual('client');
        expect(stored.meta.versionId).toStrictEqual('1');
        expect(stored.meta.lastUpdated).toBeInstanceOf(Date);
    });

    test('If-None-Match: * rejects a put to an existing resource and allows a put to a new one', async () => {
        const request = await createTestRequest();
        const id = await createPractitioner(request);

        const payload = practitionerPayload();
        payload.id = id;
        payload.active = false;
        const rejected = await request
            .put(`/4_0_0/Practitioner/${id}`)
            .send(payload)
            .set({ ...getHeaders(), 'If-None-Match': '*' });
        expect(rejected).toHaveStatusCode(412);

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('Practitioner_4_0_0').findOne({ _uuid: id });
        expect(stored.active).toStrictEqual(true);
        expect(stored.meta.versionId).toStrictEqual('1');

        const newPayload = practitionerPayload();
        newPayload.id = 'if-none-match-new';
        const created = await request
            .put('/4_0_0/Practitioner/if-none-match-new')
            .send(newPayload)
            .set({ ...getHeaders(), 'If-None-Match': '*' });
        expect(created).toHaveStatusCode(201);
    });

    test('concurrent create-via-put with If-None-Match: * lets exactly one through', async () => {
        const request = await createTestRequest();
        const send = (given) => {
            const payload = practitionerPayload();
            payload.id = 'concurrent-create';
            payload.name = [{ family: 'RACE', given: [given] }];
            return request
                .put('/4_0_0/Practitioner/concurrent-create')
                .send(payload)
                .set({ ...getHeaders(), 'If-None-Match': '*' });
        };
        const responses = await Promise.all([send('A'), send('B')]);
        expect(responses.map((r) => r.status).sort()).toStrictEqual([201, 412]);
    });

    const putWithIfMatchAfterConcurrentChange = async ({ ifMatch, concurrentChange }) => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const id = await createPractitioner(request);
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const collection = db.collection('Practitioner_4_0_0');

        const inserter = container.fastDatabaseBulkInserter;
        const originalExecute = inserter.executeAsync.bind(inserter);
        inserter.executeAsync = async (args) => {
            await concurrentChange({ collection, id });
            return await originalExecute(args);
        };
        try {
            const payload = practitionerPayload();
            payload.id = id;
            payload.name = [{ family: 'LOSER', given: ['B'] }];
            const resp = await request
                .put(`/4_0_0/Practitioner/${id}`)
                .send(payload)
                .set({ ...getHeaders(), 'If-Match': ifMatch });
            return { resp, collection, id };
        } finally {
            inserter.executeAsync = originalExecute;
        }
    };

    test('If-Match is enforced atomically when another writer lands between the read and the write', async () => {
        const { resp, collection, id } = await putWithIfMatchAfterConcurrentChange({
            ifMatch: 'W/"1"',
            concurrentChange: async ({ collection, id }) => {
                await collection.updateOne({ _uuid: id }, { $set: { 'meta.versionId': '2', active: false } });
            }
        });
        expect(resp).toHaveStatusCode(412);
        expect(resp.body.issue[0].code).toStrictEqual('precondition-failed');
        const stored = await collection.findOne({ _uuid: id });
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.name[0].family).not.toStrictEqual('LOSER');
    });

    test('If-Match: * does not recreate a resource deleted between the read and the write', async () => {
        const { resp, collection, id } = await putWithIfMatchAfterConcurrentChange({
            ifMatch: '*',
            concurrentChange: async ({ collection, id }) => {
                await collection.deleteOne({ _uuid: id });
            }
        });
        expect(resp).toHaveStatusCode(412);
        expect(await collection.findOne({ _uuid: id })).toBeNull();
    });

    test('If-Match on a resource that does not exist is rejected', async () => {
        const request = await createTestRequest();
        const payload = practitionerPayload();
        payload.id = 'missing-if-match';
        const resp = await request
            .put('/4_0_0/Practitioner/missing-if-match')
            .send(payload)
            .set({ ...getHeaders(), 'If-Match': 'W/"1"' });
        expect(resp).toHaveStatusCode(412);
    });

    test('client supplied meta.lastUpdated is ignored even when it is not a valid instant', async () => {
        const request = await createTestRequest();
        const id = await createPractitioner(request);
        for (const lastUpdated of ['2021-06-01', '2021-06-01T10:00:00', 20210601]) {
            const payload = practitionerPayload();
            payload.id = id;
            payload.active = lastUpdated === '2021-06-01';
            payload.meta.lastUpdated = lastUpdated;
            const putResp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
            expect(putResp).toHaveStatusCode(200);
            expect(putResp.body.meta.lastUpdated).not.toStrictEqual(lastUpdated);
            expect(new Date(putResp.body.meta.lastUpdated).getFullYear()).toBeGreaterThan(2025);
        }
    });

    test('empty objects in optional fields are dropped', async () => {
        const request = await createTestRequest();
        const id = await createPractitioner(request);
        const payload = practitionerPayload();
        payload.id = id;
        payload.qualification[0].period = {};
        payload.telecom.push({});
        const putResp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
        expect(putResp).toHaveStatusCode(200);
        const getResp = await request.get(`/4_0_0/Practitioner/${id}`).set(getHeaders());
        expect(getResp.body.qualification[0].period).toBeUndefined();
        expect(getResp.body.telecom).toHaveLength(1);
    });

    test('empty object for a required field fails validation', async () => {
        const request = await createTestRequest();
        const payload = observationPayload();
        const postResp = await request.post('/4_0_0/Observation').send(payload).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        const id = postResp.body.id;

        const updated = observationPayload();
        updated.id = id;
        updated.code = {};
        const resp = await request.put(`/4_0_0/Observation/${id}`).send(updated).set(getHeaders());
        expect(resp).toHaveStatusCode(400);
        expect(resp.body.issue[0].details.text).toMatch(/code/);
    });

    test('invalid nested reference fails validation', async () => {
        const request = await createTestRequest();
        const postResp = await request.post('/4_0_0/Observation').send(observationPayload()).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        const id = postResp.body.id;

        const updated = observationPayload();
        updated.id = id;
        updated.subject = {
            reference: 'Patient/5b804b54-0ff5-5dc4-9e42-6ac45c6a5f69',
            identifier: { value: 'CE33W8M0H2C6HW9', assigner: { reference: 'invalidReference' } }
        };
        const resp = await request.put(`/4_0_0/Observation/${id}`).send(updated).set(getHeaders());
        expect(resp).toHaveStatusCode(400);
        expect(resp.body.issue[0].details.text).toStrictEqual(
            'subject.identifier.assigner.reference: invalidReference is an invalid reference'
        );
    });

    test('unknown field fails validation', async () => {
        const request = await createTestRequest();
        const id = await createPractitioner(request);
        const payload = practitionerPayload();
        payload.id = id;
        payload.notAFhirField = 'x';
        const resp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
        expect(resp).toHaveStatusCode(400);
    });

    test('an oversized Group put is rejected as too-costly before its member[] is schema validated', async () => {
        const savedExtendedGroup = process.env.ENABLE_EXTENDED_GROUP;
        const savedPromotionLimit = process.env.GROUP_MEMBER_PROMOTION_LIMIT;
        process.env.ENABLE_EXTENDED_GROUP = '1';
        process.env.GROUP_MEMBER_PROMOTION_LIMIT = '3';
        try {
            const request = await createTestRequest();
            const meta = {
                source: 'client',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'client' },
                    { system: 'https://www.icanbwell.com/owner', code: 'client' }
                ]
            };
            const created = await request
                .post('/4_0_0/Group')
                .send({ resourceType: 'Group', type: 'person', actual: true, meta })
                .set(getHeaders());
            expect(created).toHaveStatusCode(201);
            const resp = await request
                .put(`/4_0_0/Group/${created.body.id}`)
                .send({
                    id: created.body.id,
                    resourceType: 'Group',
                    type: 'person',
                    actual: true,
                    notAFhirField: 'x',
                    meta,
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
});
