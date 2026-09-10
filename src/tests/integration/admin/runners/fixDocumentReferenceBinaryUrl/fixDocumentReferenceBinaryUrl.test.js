// test file
const documentReference1Resource = require('./fixtures/DocumentReference/documentReference1.json');
const documentReference2Resource = require('./fixtures/DocumentReference/documentReference2.json');
const documentReference3Resource = require('./fixtures/DocumentReference/documentReference3.json');
const binary1Resource = require('./fixtures/Binary/binary1.json');
const binary2Resource = require('./fixtures/Binary/binary2.json');

// expected
const expectedDocumentReference1AfterRun = require('./fixtures/expected/expected_documentReference1_after_run.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
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
    // DocumentReferences (and their Binary) that were persisted before the upstream
    // Binary-id-to-uuid fixer existed
    await collection.insertOne(Object.assign({}, resource));
    return collection;
}

function makeRunner (container) {
    // Instantiate directly (not via container.register/resolve) so each test gets its own
    // runner instance with fresh counters - the DI container caches resolved singletons,
    // so registering under the same key across tests would reuse the first test's instance.
    const runner = new FixDocumentReferenceBinaryUrlRunner(
        {
            batchSize: 10000,
            adminLogger: new AdminLogger(),
            mongoDatabaseManager: container.mongoDatabaseManager
        }
    );
    assertTypeEquals(runner, FixDocumentReferenceBinaryUrlRunner);
    return runner;
}

describe('FixDocumentReferenceBinaryUrl Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('FixDocumentReferenceBinaryUrl runner Tests', () => {
        test('links content[].attachment.url to the real Binary.id found via meta.source, without generating a uuid', async () => {
            await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const documentReferenceCollection = await insertDirectlyAsync(
                mongoDatabaseManager, documentReference1Resource, 'DocumentReference_4_0_0'
            );
            await insertDirectlyAsync(mongoDatabaseManager, binary1Resource, 'Binary_4_0_0');

            const runner = makeRunner(container);
            await runner.processAsync();

            const documentReference1 = await documentReferenceCollection.findOne({ id: documentReference1Resource.id });
            expect(documentReference1).toBeDefined();
            delete documentReference1._id;
            expect(documentReference1.meta.lastUpdated).toBeDefined();
            expectedDocumentReference1AfterRun.meta.lastUpdated = documentReference1.meta.lastUpdated;
            expect(documentReference1).toStrictEqual(expectedDocumentReference1AfterRun);

            // the linked id came straight from Binary1.id, not from any uuid5 computation
            expect(documentReference1.content[0].attachment.url).toStrictEqual(`Binary/${binary1Resource.id}`);
            expect(runner.numberOfUrlsFixed).toStrictEqual(1);
        });

        test('leaves the url unchanged when no Binary matches by meta.source', async () => {
            await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const documentReferenceCollection = await insertDirectlyAsync(
                mongoDatabaseManager, documentReference2Resource, 'DocumentReference_4_0_0'
            );
            // no Binary_4_0_0 document inserted at all - nothing to link to

            const runner = makeRunner(container);
            await runner.processAsync();

            const documentReference2 = await documentReferenceCollection.findOne({ id: documentReference2Resource.id });
            expect(documentReference2).toBeDefined();
            expect(documentReference2.content[0].attachment.url).toStrictEqual('Binary/legacyTokenNoMatch.456');
            expect(documentReference2.meta.lastUpdated).toStrictEqual(documentReference2Resource.meta.lastUpdated);
            expect(runner.numberOfUrlsFixed).toStrictEqual(0);
            expect(runner.numberOfUnresolvedBinaryReferences).toStrictEqual(1);
        });

        test('does not match a Binary whose meta.source merely contains the id without a preceding "/"', async () => {
            await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const documentReferenceCollection = await insertDirectlyAsync(
                mongoDatabaseManager, documentReference3Resource, 'DocumentReference_4_0_0'
            );
            // binary2's meta.source ends with "XlegacyTokenEdge.999" - not "/legacyTokenEdge.999" -
            // must not be treated as a match
            await insertDirectlyAsync(mongoDatabaseManager, binary2Resource, 'Binary_4_0_0');

            const runner = makeRunner(container);
            await runner.processAsync();

            const documentReference3 = await documentReferenceCollection.findOne({ id: documentReference3Resource.id });
            expect(documentReference3).toBeDefined();
            expect(documentReference3.content[0].attachment.url).toStrictEqual('Binary/legacyTokenEdge.999');
            expect(runner.numberOfUrlsFixed).toStrictEqual(0);
            expect(runner.numberOfUnresolvedBinaryReferences).toStrictEqual(1);
        });
    });
});
