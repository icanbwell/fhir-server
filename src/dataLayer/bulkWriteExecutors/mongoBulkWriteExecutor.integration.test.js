// Integration test: proves the MongoBulkWriteExecutor produces identical behavior
// to the old inline code by exercising the full write pipeline end-to-end via
// the FHIR $merge HTTP endpoint through to MongoDB and back.

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getTestContainer,
    mockHttpContext
} = require('../../tests/common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

const practitionerResource = [
    {
        resourceType: 'Practitioner',
        id: 'practitioner-bulk-test-1',
        meta: {
            source: 'bwell',
            security: [
                {
                    system: 'https://www.icanbwell.com/access',
                    code: 'bwell'
                },
                {
                    system: 'https://www.icanbwell.com/owner',
                    code: 'bwell'
                }
            ]
        },
        active: true,
        name: [
            {
                family: 'Smith',
                given: ['John']
            }
        ]
    }
];

const auditEventResource = [
    {
        resourceType: 'AuditEvent',
        id: 'audit-bulk-test-1',
        meta: {
            source: 'bwell',
            security: [
                {
                    system: 'https://www.icanbwell.com/access',
                    code: 'bwell'
                },
                {
                    system: 'https://www.icanbwell.com/owner',
                    code: 'bwell'
                }
            ]
        },
        type: {
            system: 'http://dicom.nema.org/resources/ontology/DCM',
            code: '110112',
            display: 'Query'
        },
        recorded: '2021-01-01T00:00:00Z',
        agent: [
            {
                requestor: true
            }
        ],
        source: {
            observer: {
                display: 'test'
            }
        }
    }
];

describe('MongoBulkWriteExecutor Integration Tests', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('merge create: resource and history document are written to MongoDB', async () => {
        const request = await createTestRequest();

        // Merge a new Practitioner (create)
        let resp = await request
            .post('/4_0_0/Practitioner/1/$merge')
            .send(practitionerResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();
        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        // Verify resource exists via GET
        resp = await request
            .get('/4_0_0/Practitioner/practitioner-bulk-test-1')
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.id).toBe('practitioner-bulk-test-1');
        expect(resp.body.active).toBe(true);
        expect(resp.body.name[0].family).toBe('Smith');

        // Verify history version 1 exists via API
        resp = await request
            .get('/4_0_0/Practitioner/practitioner-bulk-test-1/_history/1')
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.id).toBe('practitioner-bulk-test-1');

        // Verify directly in MongoDB that main collection has the document
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const fhirDb = await mongoDatabaseManager.getClientDbAsync();
        const practitionerCollection = fhirDb.collection('Practitioner_4_0_0');
        const doc = await practitionerCollection.findOne({ id: 'practitioner-bulk-test-1' });
        expect(doc).not.toBeNull();
        expect(doc.active).toBe(true);

        // Verify history collection has the document (stored as BundleEntry with resource nested)
        const historyCollection = fhirDb.collection('Practitioner_4_0_0_History');
        const historyDoc = await historyCollection.findOne({ 'resource.id': 'practitioner-bulk-test-1' });
        expect(historyDoc).not.toBeNull();
    });

    test('merge update: second merge with changed field writes new history version', async () => {
        const request = await createTestRequest();

        // Create the resource first
        let resp = await request
            .post('/4_0_0/Practitioner/1/$merge')
            .send(practitionerResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();
        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        // Now merge with a change (update): flip active from true to false
        const updatedPractitioner = deepcopy(practitionerResource);
        updatedPractitioner[0].active = false;

        resp = await request
            .post('/4_0_0/Practitioner/1/$merge')
            .send(updatedPractitioner)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: false, updated: true });

        await postRequestProcessor.waitTillDoneAsync({ requestId });

        // Verify updated resource via GET
        resp = await request
            .get('/4_0_0/Practitioner/practitioner-bulk-test-1')
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.active).toBe(false);

        // Verify history version 2 exists
        resp = await request
            .get('/4_0_0/Practitioner/practitioner-bulk-test-1/_history/2')
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);

        // Verify history version 1 still exists
        resp = await request
            .get('/4_0_0/Practitioner/practitioner-bulk-test-1/_history/1')
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
    });

    test('merge identical resource: no update occurs', async () => {
        const request = await createTestRequest();

        // Create
        let resp = await request
            .post('/4_0_0/Practitioner/1/$merge')
            .send(practitionerResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();
        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        // Merge same resource again (no changes)
        resp = await request
            .post('/4_0_0/Practitioner/1/$merge')
            .send(practitionerResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: false, updated: false });
    });

    test('AuditEvent merge: no history document is written', async () => {
        const request = await createTestRequest();

        // Merge an AuditEvent
        let resp = await request
            .post('/4_0_0/AuditEvent/1/$merge')
            .send(auditEventResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();
        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        // Verify AuditEvent exists directly in MongoDB
        // AuditEvent is stored in the separate audit database, not the main fhir database
        const mongoDatabaseManager = container.mongoDatabaseManager;
        const auditDb = await mongoDatabaseManager.getAuditDbAsync();
        const auditEventCollection = auditDb.collection('AuditEvent_4_0_0');
        const doc = await auditEventCollection.findOne({ id: 'audit-bulk-test-1' });
        expect(doc).not.toBeNull();
        expect(doc.id).toBe('audit-bulk-test-1');

        // Verify NO history collection exists for AuditEvent
        // AuditEvent is explicitly excluded from history writes in MongoBulkWriteExecutor._postSaveAsync
        const collections = await auditDb.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        expect(collectionNames).toContain('AuditEvent_4_0_0');
        expect(collectionNames).not.toContain('AuditEvent_4_0_0_History');
    });
});
