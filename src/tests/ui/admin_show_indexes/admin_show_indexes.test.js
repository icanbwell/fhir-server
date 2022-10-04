const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer, getHtmlHeadersWithAdminToken, getJsonHeadersWithAdminToken,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

const {customIndexes} = require('./mockCustomIndexes');
const {IndexProvider} = require('../../../indexes/indexProvider');

class MockIndexProvider extends IndexProvider {
    getIndexes() {
        return customIndexes;
    }
}

describe('Show Indexes UI Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Show Indexes Tests', () => {
        test('admin search fails without scope', async () => {
            const request = await createTestRequest((c) => {
                c.register('indexProvider', () => new MockIndexProvider());
                return c;
            });
            let resp = await request.get('/admin/indexes?id=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
        });
        test('admin search passes with scope and json format', async () => {
            const request = await createTestRequest((c) => {
                c.register('indexProvider', () => new MockIndexProvider());
                return c;
            });
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Patient_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const patientCollection = fhirDb.collection(collectionName);
            await patientCollection.insertOne({id: '1', resourceType: 'Patient'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName,
                db: fhirDb
            });

            let resp = await request.get('/admin/indexes').set(getJsonHeadersWithAdminToken());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
        });
        test('admin search passes with scope', async () => {
            const request = await createTestRequest((c) => {
                c.register('indexProvider', () => new MockIndexProvider());
                return c;
            });
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {IndexManager}
             */
            const indexManager = container.indexManager;
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            // create collection
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Patient_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const patientCollection = fhirDb.collection(collectionName);
            await patientCollection.insertOne({id: '1', resourceType: 'Patient'});
            // run indexManager
            await indexManager.indexCollectionAsync({
                collectionName,
                db: fhirDb
            });

            let resp = await request.get('/admin/indexes?id=1').set(getHtmlHeadersWithAdminToken());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();

            expect(resp.type).toStrictEqual('text/html');
            expect(resp.body).toStrictEqual({});
            expect(resp.text).not.toBeNull();
            expect(resp.text).toMatch(new RegExp('^<!DOCTYPE html>?'));
        });
    });
});
