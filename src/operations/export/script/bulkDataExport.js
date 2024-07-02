const { createContainer } = require('../../../createContainer');
const { CommandLineParser } = require('../../../admin/scripts/commandLineParser');
const { BulkDataExportRunner } = require('./bulkDataExportRunner');
const { S3Client } = require('../../../utils/s3Client');
const { logInfo, logError } = require('../../common/logging');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();

    /**
     * @type {string}
     */
    const exportStatusId = String(parameters.exportStatusId);

    if (!exportStatusId) {
        throw new Error('Cannot run Bulk export script without exportStatusId param');
    }

    const batchSize = parameters.batchSize || process.env.BULK_BUFFER_SIZE || 1000;

    const fetchResourceBatchSize = parameters.fetchResourceBatchSize || 1000;

    const uploadPartSize = parameters.uploadPartSize || (1024 * 1024 * 100); // 100 mb

    const bulkExportS3BucketName = parameters.bulkExportS3BucketName;

    const awsRegion = parameters.awsRegion;

    const currentDateTime = new Date();

    logInfo(
        `[${currentDateTime}] Running Bulk data export script for ${exportStatusId}`
    );

    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'bulkDataExportRunner',
        (c) =>
            new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                patientQueryCreator: c.patientQueryCreator,
                enrichmentManager: c.enrichmentManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                r4ArgsParser: c.r4ArgsParser,
                searchManager: c.searchManager,
                exportStatusId,
                batchSize,
                fetchResourceBatchSize,
                uploadPartSize,
                s3Client: new S3Client({
                    bucketName: bulkExportS3BucketName,
                    region: awsRegion
                })
            })
    );

    /**
     * @type {BulkDataExportRunner}
     */
    const bulkDataExportRunner = container.bulkDataExportRunner;
    await bulkDataExportRunner.processAsync();

    logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * node src/operations/export/script/bulkDataExport.js --exportStatusId=abee1b6a-90ee-4523-8429-f320e5da2886 --bulkExportS3BucketName s3Bucket --uploadPartSize 1024
 * NODE_OPTIONS=--max_old_space_size=8192 node --max-old-space-size=8192 src/operations/export/script/bulkDataExport.js --exportStatusId=abee1b6a-90ee-4523-8429-f320e5da2886 --bulkExportS3BucketName s3Bucket
 */
main().catch((reason) => {
    logError(reason);
    process.exit(1);
});
