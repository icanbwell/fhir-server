// test file
const exportStatus1Resource = require('./fixtures/exportStatus/exportStatus1.json');
const exportStatus2Resource = require('./fixtures/exportStatus/exportStatus2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getTestContainer,
    createTestRequest,
    getHeaders
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const env = require('var');
const moment = require('moment-timezone');
const { CronJobRunner } = require('../../operations/export/script/cronJobRunner');
const { MockK8sClient } = require('./mocks/k8sClient');

describe('Export Trigger Tests', () => {
    beforeEach(async () => {
        env.ENABLE_BULK_EXPORT = '1';
        const container = getTestContainer();
        if (container) {
            delete container.services.cronJobRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        jest.clearAllMocks();
        env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    test('Triggering export job', async () => {
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

        // Adding resources in db
        const result = await collection.insertOne(
            exportStatus1Resource
        );
        expect(result.acknowledged).toEqual(true);

        // Running cron job script
        container.register(
            'cronJobRunner',
            (c) =>
                new CronJobRunner({
                    databaseQueryFactory: c.databaseQueryFactory,
                    databaseExportManager: c.databaseExportManager,
                    exportManager: c.exportManager,
                    configManager: c.configManager
                })
        );

        await request
            .post(`/admin/triggerExport/${exportStatus1Resource.id}`)
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .expect(200);

        // Verifying if createJob function is called with correct id
        expect(mockK8sCreateJob).toHaveBeenCalledTimes(1);
        expect(mockK8sCreateJob).toHaveBeenCalledWith(
            expect.objectContaining({
                scriptCommand: expect.stringContaining(`${exportStatus1Resource.id}`)
            })
        );
        expect(mockK8sCreateJob).toHaveBeenCalledWith(
            expect.objectContaining({
                scriptCommand: expect.stringContaining(`--requestId`)
            })
        );
    });

    test('Triggering export job when export status resource not found', async () => {
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
        const mockK8CreateJob = jest.spyOn(container.k8sClient, 'createJob');

        // Running cron job script
        container.register(
            'cronJobRunner',
            (c) =>
                new CronJobRunner({
                    databaseQueryFactory: c.databaseQueryFactory,
                    databaseExportManager: c.databaseExportManager,
                    exportManager: c.exportManager,
                    configManager: c.configManager
                })
        );

        const exportTriggerResponse = await request
            .post(`/admin/triggerExport/${exportStatus2Resource.id}`)
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .expect(404);

        expect(exportTriggerResponse).toHaveResponse(
            {
                issue: [{
                    code: "exception",
                    diagnostics: `ExportStatus resoure with id ${exportStatus2Resource.id} doesn't exists`,
                    severity: "error"
                }],
                resourceType: "OperationOutcome"
            }
        );

        // Verifying if createJob function is not called
        expect(mockK8CreateJob).toHaveBeenCalledTimes(0);
    });
});
