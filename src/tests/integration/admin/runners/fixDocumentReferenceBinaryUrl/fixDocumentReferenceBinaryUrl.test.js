// test file
const documentReference1Resource = require('./fixtures/DocumentReference/documentReference1.json');
const documentReference2Resource = require('./fixtures/DocumentReference/documentReference2.json');
const documentReference3Resource = require('./fixtures/DocumentReference/documentReference3.json');

// expected
const expectedDocumentReference1AfterRun = require('./fixtures/expected/expected_documentReference1_after_run.json');
const expectedDocumentReference2AfterRun = require('./fixtures/expected/expected_documentReference2_after_run.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getTestContainer
} = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AdminLogger } = require('../../../../../admin/adminLogger');
const {
    FixDocumentReferenceBinaryUrlRunner
} = require('../../../../../admin/runners/fixDocumentReferenceBinaryUrlRunner');
const { assertTypeEquals } = require('../../../../../utils/assertType');

async function insertDirectlyAsync (mongoDatabaseManager, resource, collectionName) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();
    const collection = fhirDb.collection(collectionName);
    // insert directly into the database instead of going through $merge so we simulate
    // DocumentReferences that were persisted before the upstream Binary-id-to-uuid fixer existed
    await collection.insertOne(Object.assign({}, resource));
    return collection;
}

describe('FixDocumentReferenceBinaryUrl Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('FixDocumentReferenceBinaryUrl runner Tests', () => {
        test('rewrites legacy Binary content url to uuid5 and leaves already-uuid entries untouched', async () => {
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const collection = await insertDirectlyAsync(
                mongoDatabaseManager, documentReference1Resource, 'DocumentReference_4_0_0'
            );

            container.register(
                'fixDocumentReferenceBinaryUrlRunner',
                (c) => new FixDocumentReferenceBinaryUrlRunner(
                    {
                        batchSize: 10000,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager
                    }
                )
            );

            /**
             * @type {FixDocumentReferenceBinaryUrlRunner}
             */
            const fixDocumentReferenceBinaryUrlRunner = container.fixDocumentReferenceBinaryUrlRunner;
            assertTypeEquals(fixDocumentReferenceBinaryUrlRunner, FixDocumentReferenceBinaryUrlRunner);
            await fixDocumentReferenceBinaryUrlRunner.processAsync();

            const documentReference1 = await collection.findOne({ id: documentReference1Resource.id });
            expect(documentReference1).toBeDefined();
            delete documentReference1._id;
            expect(documentReference1.meta.lastUpdated).toBeDefined();
            expectedDocumentReference1AfterRun.meta.lastUpdated = documentReference1.meta.lastUpdated;
            expect(documentReference1).toStrictEqual(expectedDocumentReference1AfterRun);
        });

        test('falls back to meta.security sourceAssigningAuthority when the shadow column is missing', async () => {
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const collection = await insertDirectlyAsync(
                mongoDatabaseManager, documentReference2Resource, 'DocumentReference_4_0_0'
            );

            container.register(
                'fixDocumentReferenceBinaryUrlRunner',
                (c) => new FixDocumentReferenceBinaryUrlRunner(
                    {
                        batchSize: 10000,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager
                    }
                )
            );

            /**
             * @type {FixDocumentReferenceBinaryUrlRunner}
             */
            const fixDocumentReferenceBinaryUrlRunner = container.fixDocumentReferenceBinaryUrlRunner;
            await fixDocumentReferenceBinaryUrlRunner.processAsync();

            const documentReference2 = await collection.findOne({ id: documentReference2Resource.id });
            expect(documentReference2).toBeDefined();
            delete documentReference2._id;
            expect(documentReference2.meta.lastUpdated).toBeDefined();
            expectedDocumentReference2AfterRun.meta.lastUpdated = documentReference2.meta.lastUpdated;
            expect(documentReference2).toStrictEqual(expectedDocumentReference2AfterRun);
        });

        test('leaves content untouched when no sourceAssigningAuthority can be determined', async () => {
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const collection = await insertDirectlyAsync(
                mongoDatabaseManager, documentReference3Resource, 'DocumentReference_4_0_0'
            );

            container.register(
                'fixDocumentReferenceBinaryUrlRunner',
                (c) => new FixDocumentReferenceBinaryUrlRunner(
                    {
                        batchSize: 10000,
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager
                    }
                )
            );

            /**
             * @type {FixDocumentReferenceBinaryUrlRunner}
             */
            const fixDocumentReferenceBinaryUrlRunner = container.fixDocumentReferenceBinaryUrlRunner;
            await fixDocumentReferenceBinaryUrlRunner.processAsync();

            const documentReference3 = await collection.findOne({ id: documentReference3Resource.id });
            expect(documentReference3).toBeDefined();
            // unchanged: same content, same lastUpdated - no bulk operation should have been produced for it
            expect(documentReference3.content[0].attachment.url).toStrictEqual('Binary/legacyTokenNoAuthority.789');
            expect(documentReference3.meta.lastUpdated).toStrictEqual(documentReference3Resource.meta.lastUpdated);
        });
    });
});
