const person1Resource = require('./fixtures/person/person_1.json');
const person2Resource = require('./fixtures/person/person_2.json');

const patient1Resource = require('./fixtures/patient/patient_1.json');
const patient2Resource = require('./fixtures/patient/patient_2.json');

const consent2Resource = require('./fixtures/consent/consent_2.json');

const organizationCms = require('./fixtures/organization/organization_cms.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getTokenWithCustomPayload,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { AuditLogger } = require('../../../utils/auditLogger');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const PERSON_ID_1 = '08f1b73a-e27c-456d-8a61-277f164a9a57-1';
const PATIENT_ID_2 = '08f1b73a-e27c-456d-8a61-277f164a9a57-2';

const CONSENT_POLICY_REGEX = /^Consent\/.+\?version=.+$/;

const getCmsHeaders = (personId) => {
    const token = getTokenWithCustomPayload({
        scope: 'patient/*.read user/*.read access/*.read',
        user_type: 'cms-partner',
        username: personId,
        clientFhirPersonId: personId,
        bwellFhirPersonId: personId,
        clientFhirPatientId: `person.${personId}`,
        bwellFhirPatientId: `person.${personId}`,
        managingOrganization: organizationCms.id
    });
    return {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
        Host: 'localhost:3000'
    };
};

const registerRealAuditLogger = (container) => {
    container.register(
        'auditLogger',
        (c) =>
            new AuditLogger({
                postRequestProcessor: c.postRequestProcessor,
                databaseBulkInserter: c.databaseBulkInserter,
                preSaveManager: c.preSaveManager,
                configManager: c.configManager
            })
    );
    return container;
};

const getAuditEvents = async ({ request, action }) => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateFilter = `date=ge${start}&date=le${end}`;
    const actionFilter = action ? `&action=${action}` : '';
    const resp = await request
        .get(`/4_0_0/AuditEvent/?${dateFilter}${actionFilter}&_bundle=1&_count=100`)
        .set(getHeaders());
    expect(resp).toHaveStatusCode(200);
    return (resp.body.entry || []).map((e) => e.resource);
};

describe('CMS Data Sharing - consent reference on AuditEvent.agent.policy', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    let requestId;
    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Patient search with matching consent: audit agent[0].policy carries consent reference', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const container = getTestContainer();
        /** @type {PostRequestProcessor} */
        const postRequestProcessor = container.postRequestProcessor;
        /** @type {import('../../../utils/auditLogger').AuditLogger} */
        const auditLogger = container.auditLogger;

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                patient1Resource,
                patient2Resource,
                consent2Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();

        const auditLogsBeforeQuery = await getAuditEvents({ request, action: 'R' });

        resp = await request
            .get('/4_0_0/Patient?_bundle=1&_count=100')
            .set(getCmsHeaders(PERSON_ID_1));
        expect(resp).toHaveStatusCode(200);

        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();

        const existingIds = new Set(auditLogsBeforeQuery.map((l) => l.id));
        const readLogs = (await getAuditEvents({ request, action: 'R' })).filter(
            (l) => !existingIds.has(l.id)
        );
        expect(readLogs.length).toBeGreaterThanOrEqual(1);

        for (const log of readLogs) {
            expect(Array.isArray(log.agent)).toBe(true);
            expect(log.agent).toHaveLength(1);
            expect(Array.isArray(log.agent[0].policy)).toBe(true);
            expect(log.agent[0].policy).toHaveLength(1);
            expect(log.agent[0].policy[0]).toMatch(CONSENT_POLICY_REGEX);
        }
    });

    test('Patient $everything with matching consent: every audit event has same consent reference', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const container = getTestContainer();
        /** @type {PostRequestProcessor} */
        const postRequestProcessor = container.postRequestProcessor;
        /** @type {import('../../../utils/auditLogger').AuditLogger} */
        const auditLogger = container.auditLogger;

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                patient1Resource,
                patient2Resource,
                consent2Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();

        const auditLogsBeforeQuery = await getAuditEvents({ request });

        resp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID_2}/$everything?contained=true`)
            .set(getCmsHeaders(PERSON_ID_1));
        expect(resp).toHaveStatusCode(200);

        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();

        const existingIds = new Set(auditLogsBeforeQuery.map((l) => l.id));
        const newLogs = (await getAuditEvents({ request })).filter((l) => !existingIds.has(l.id));
        expect(newLogs.length).toBeGreaterThanOrEqual(1);

        const readLogs = newLogs.filter((l) => l.action === 'R');
        expect(readLogs.length).toBeGreaterThanOrEqual(1);

        const policies = new Set();
        for (const log of readLogs) {
            expect(Array.isArray(log.agent)).toBe(true);
            expect(log.agent.length).toBeGreaterThanOrEqual(1);
            const policy = log.agent[0].policy;
            expect(Array.isArray(policy)).toBe(true);
            expect(policy).toHaveLength(1);
            expect(policy[0]).toMatch(CONSENT_POLICY_REGEX);
            policies.add(policy[0]);
        }

        expect(policies.size).toBe(1);
    });

    test('Patient search with NO matching consent: no audit events are written', async () => {
        const request = await createTestRequest(registerRealAuditLogger);
        const container = getTestContainer();
        /** @type {PostRequestProcessor} */
        const postRequestProcessor = container.postRequestProcessor;
        /** @type {import('../../../utils/auditLogger').AuditLogger} */
        const auditLogger = container.auditLogger;

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                person1Resource,
                person2Resource,
                patient1Resource,
                patient2Resource,
                organizationCms
            ])
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();

        const auditLogsBeforeQuery = await getAuditEvents({ request });

        resp = await request
            .get('/4_0_0/Patient?_bundle=1&_count=100')
            .set(getCmsHeaders(PERSON_ID_1));
        expect(resp).toHaveStatusCode(200);
        const entries = (resp.body.entry || []).filter(
            (e) => e.resource && e.resource.resourceType !== 'OperationOutcome'
        );
        expect(entries.length).toBe(0);

        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();

        const existingIds = new Set(auditLogsBeforeQuery.map((l) => l.id));
        const newLogs = (await getAuditEvents({ request })).filter((l) => !existingIds.has(l.id));
        expect(newLogs.length).toBe(0);
    });
});
