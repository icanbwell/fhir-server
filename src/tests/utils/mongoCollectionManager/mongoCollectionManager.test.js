const {
    commonBeforeEach,
    commonAfterEach
} = require('../../common');
const { createTestContainer } = require('../../createTestContainer');

describe('mongoCollectionManager cache Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('mongoCollectionManager cache check', () => {
        test('collection name stored in map', async () => {
            const container = createTestContainer();
            const documentReferenceCollection = 'DocumentReference_4_0_0';
            /*
            * @type {MongoCollectionManager}
            */
            const mongoCollectionManager = container.mongoCollectionManager;

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const db = await mongoDatabaseManager.getClientDbAsync();

            await mongoCollectionManager.getOrCreateCollectionAsync({db, collectionName: documentReferenceCollection});

            expect(mongoCollectionManager.databaseCollectionStatusMap.size).toEqual(1);
            expect(mongoCollectionManager.databaseCollectionStatusMap.has(documentReferenceCollection)).toBeTrue();

            await mongoCollectionManager.getOrCreateCollectionAsync({db, collectionName: documentReferenceCollection});

            expect(mongoCollectionManager.databaseCollectionStatusMap.size).toEqual(1);
        });

        test('exisiting collection added in map', async () => {
            const container = await createTestContainer();
            const documentReferenceCollection = 'DocumentReference_4_0_0';
            const patientCollection = 'Patient_4_0_0';
            /*
            * @type {MongoCollectionManager}
            */
            const mongoCollectionManager = container.mongoCollectionManager;

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            const db = await mongoDatabaseManager.getClientDbAsync();

            await db.createCollection(patientCollection);

            await mongoCollectionManager.getOrCreateCollectionAsync({db, collectionName: documentReferenceCollection});

            expect(mongoCollectionManager.databaseCollectionStatusMap.size).toEqual(2);
            expect(mongoCollectionManager.databaseCollectionStatusMap.has(documentReferenceCollection)).toBeTrue();
            expect(mongoCollectionManager.databaseCollectionStatusMap.has(patientCollection)).toBeTrue();
        });
    });
});
