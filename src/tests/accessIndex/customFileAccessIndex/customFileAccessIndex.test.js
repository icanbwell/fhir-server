const path = require('path');
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');
const encounter1Resource = require('./fixtures/Encounter/encounter1.json');

const expectedAuditEventResourcesAccessIndex = require('./fixtures/expected/expected_AuditEvent_access_index.json');
const expectedAuditEventWithoutAccessIndex = require('./fixtures/expected/expected_AuditEvent_without_access_index.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer, mockHttpContext } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

const customIndexesFilePath = path.resolve(__dirname, './fixtures/customIndexes.json');

describe('Custom File Access Index Tests', () => {
    let requestId;
    const originalUseAccessIndex = process.env.USE_ACCESS_INDEX;
    const originalCustomIndexesFilePath = process.env.CUSTOM_INDEXES_FILE_PATH;
    const originalAccessTagsIndexed = process.env.ACCESS_TAGS_INDEXED;

    beforeAll(() => {
        process.env.USE_ACCESS_INDEX = '1';
        process.env.CUSTOM_INDEXES_FILE_PATH = customIndexesFilePath;
        delete process.env.ACCESS_TAGS_INDEXED;
    });

    afterAll(() => {
        if (originalUseAccessIndex === undefined) {
            delete process.env.USE_ACCESS_INDEX;
        } else {
            process.env.USE_ACCESS_INDEX = originalUseAccessIndex;
        }
        if (originalCustomIndexesFilePath === undefined) {
            delete process.env.CUSTOM_INDEXES_FILE_PATH;
        } else {
            process.env.CUSTOM_INDEXES_FILE_PATH = originalCustomIndexesFilePath;
        }
        if (originalAccessTagsIndexed === undefined) {
            delete process.env.ACCESS_TAGS_INDEXED;
        } else {
            process.env.ACCESS_TAGS_INDEXED = originalAccessTagsIndexed;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('accessIndex uses custom file for determining indexed access codes', () => {
        test('accessIndex works for access codes defined in custom index file', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            let resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-08-09&date=lt2021-10-09').set(getHeaders());
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            const auditLogger = container.auditLogger;
            await auditLogger.flushAsync();

            const mongoDatabaseManager = container.mongoDatabaseManager;
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            const internalAuditEventCollection = auditEventDb.collection('AuditEvent_4_0_0');

            const client1AuditEntries = await internalAuditEventCollection.find({ id: 'MixP-0001r5i3yr8g2cuj' }).toArray();
            expect(client1AuditEntries.length).toBe(1);
            expect(client1AuditEntries[0]._access.client1).toBe(1);

            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7Cclient1&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z')
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedAuditEventResourcesAccessIndex);
        });

        test('accessIndex works when _access key is among multiple index keys', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            let resp = await request.get('/4_0_0/Encounter').set(getHeaders());
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Encounter/encounter-test-1/$merge?validate=true')
                .send(encounter1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            const mongoDatabaseManager = container.mongoDatabaseManager;
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const encounterCollection = fhirDb.collection('Encounter_4_0_0');

            const encounterEntries = await encounterCollection.find({ id: 'encounter-test-1' }).toArray();
            expect(encounterEntries.length).toBe(1);
            expect(encounterEntries[0]._access.client1).toBe(1);

            resp = await request
                .get('/4_0_0/Encounter/?_bundle=1&_debug=1&_security=https://www.icanbwell.com/access%7Cclient1')
                .set(getHeaders());
            expect(resp).toHaveStatusCode(200);
            expect(resp).toHaveResourceCount(1);

            const queryTag = resp.body.meta.tag.find(t => t.system === 'https://www.icanbwell.com/query');
            expect(queryTag.display).toContain('_access.client1');
            expect(queryTag.display).not.toContain('meta.security');
        });

        test('indexHinter resolves named index from custom index file', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            const indexHinter = container.indexHinter;

            // Verify field-based lookup finds the correct index from custom file
            const result = indexHinter.findIndexForFields(
                'AuditEvent_4_0_0',
                ['_access.client1', 'recorded', '_uuid'],
                undefined
            );
            expect(result).toBe('access_client1_recorded_uuid');

            // Verify named index lookup by name (needs non-empty fields to pass the guard)
            const resultByName = indexHinter.findIndexForFields(
                'AuditEvent_4_0_0',
                ['_access.client1', 'recorded', '_uuid'],
                'access_client1_recorded_uuid'
            );
            expect(resultByName).toBe('access_client1_recorded_uuid');
        });

        test('indexHinter resolves wildcard index for any collection from custom file', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            const indexHinter = container.indexHinter;

            // _uuid index is in '*' so should match for Patient
            const result = indexHinter.findIndexForFields(
                'Patient_4_0_0',
                ['_uuid'],
                undefined
            );
            expect(result).toBe('uuid');
        });

        test('indexHinter returns null for index not in custom file', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            const indexHinter = container.indexHinter;

            // Non-existent index name
            const result = indexHinter.findIndexForFields(
                'AuditEvent_4_0_0',
                ['_access.client1'],
                'nonexistent_index'
            );
            expect(result).toBeNull();

            // Fields that don't match any index
            const resultByFields = indexHinter.findIndexForFields(
                'AuditEvent_4_0_0',
                ['nonexistent_field', 'another_field'],
                undefined
            );
            expect(resultByFields).toBeNull();
        });

        test('accessIndex is not used for access codes not in custom index file', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            let resp = await request.get('/4_0_0/AuditEvent/?date=gt2021-08-09&date=lt2021-10-09').set(getHeaders());
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            const auditLogger = container.auditLogger;
            await auditLogger.flushAsync();

            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_count=2&_getpagesoffset=0&_security=https://www.icanbwell.com/access%7CclientAbc&date=lt2021-09-22T00:00:00Z&date=ge2021-09-19T00:00:00Z&_debug=1')
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedAuditEventWithoutAccessIndex);
        });
    });
});
