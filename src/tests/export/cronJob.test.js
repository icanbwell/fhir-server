// test file
const exportStatus1Resource = require('./fixtures/exportStatus/exportStatus1.json');
const exportStatus2Resource = require('./fixtures/exportStatus/exportStatus2.json');
const exportStatus3Resource = require('./fixtures/exportStatus/exportStatus3.json');
const exportStatus4Resource = require('./fixtures/exportStatus/exportStatus4.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getTestContainer,
    createTestRequest
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const env = require('var');
const moment = require('moment-timezone');
const { CronJobRunner } = require('../../operations/export/script/cronJobRunner');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');

describe('Cron Job Tests', () => {
    beforeEach(async () => {
        env.ENABLE_BULK_EXPORT = '1';
        const container = getTestContainer();
        if (container) {
            delete container.services.cronJobRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    describe('Cron Job tests', () => {
        test.only('Triggering k8 job and updating in-progress resources', async () => {
            const request = await createTestRequest((c) => {
                c.register(
                    'k8sClient',
                    (c) =>
                        new MockK8sClient({
                            configManager: c.configManager
                        })
                );
                return c;
            });
            const container = getTestContainer();
            const mockK8sCreateJob = jest.spyOn(container.k8sClient, 'createJob');

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collection = fhirDb.collection('ExportStatus_4_0_0');

            // Setting lastUpdated field for ExportStatus resources to be added
            exportStatus1Resource.meta.lastUpdated = new Date(
                moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')
            );
            exportStatus2Resource.meta.lastUpdated = new Date(
                moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')
            );
            // Setting lastUpdated before last 24 hrs
            exportStatus3Resource.meta.lastUpdated = moment().subtract(48, 'hours').toDate();
            exportStatus4Resource.meta.lastUpdated = new Date(
                moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')
            );

            // Adding resources in db
            const result = await collection.insertMany([
                exportStatus1Resource,
                exportStatus2Resource,
                exportStatus3Resource,
                exportStatus4Resource
            ]);
            expect(result.insertedCount).toEqual(4);

            // Running cron job script
            container.register(
                'cronJobRunner',
                (c) =>
                    new CronJobRunner({
                        databaseQueryFactory: c.databaseQueryFactory,
                        databaseExportManager: c.databaseExportManager,
                        exportManager: c.exportManager,
                        configManager: c.configManager,
                        exportEventProducer: c.exportEventProducer
                    })
            );
            const cronJobRunner = container.cronJobRunner;
            await cronJobRunner.processAsync();

            const databaseQueryManager = container.databaseQueryFactory.createQuery({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            // Fetch resources with status updated to 'entered-in-error'
            const exportStatusCursor = await databaseQueryManager.findOneAsync({
                query: { status: 'entered-in-error' }
            });

            // Only resource 3 with status 'in-progress' and meta.lastUpdated older than 24 hrs is updated
            expect(exportStatusCursor.id).toEqual(exportStatus3Resource.id);
            expect(exportStatusCursor.status).toEqual('entered-in-error');

            // Resource 4 with in-progress status but lastUpdated not older than 24hrs is not updated
            const resource4 = await collection.findOne({ id: exportStatus4Resource.id });
            expect(resource4.status).toEqual(exportStatus4Resource.status);

            // Verifying if createJob function is called only 2 times and is passed ids of ExportStatus resource
            // with 'accepted' status only
            expect(mockK8sCreateJob).toHaveBeenCalledTimes(2);
            expect(mockK8sCreateJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    scriptCommand: expect.stringContaining(`${exportStatus1Resource.id}`)
                })
            );
            expect(mockK8sCreateJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    scriptCommand: expect.stringContaining(`${exportStatus2Resource.id}`)
                })
            );
        });
    });
});
