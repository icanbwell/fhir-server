const { DatabaseImportManager } = require('../../../dataLayer/databaseImportManager');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');
const { logInfo, logError } = require('../../common/logging');

class BulkDataImportRunner {
    /**
     * @typedef {Object} ConstructorParams
     * @property {DatabaseImportManager} databaseImportManager
     * @property {string} importStatusId
     * @property {string} awsRegion
     * @property {string} requestId
     *
     * @param {ConstructorParams}
     */
    constructor({ databaseImportManager, importStatusId, awsRegion, requestId }) {
        this.databaseImportManager = databaseImportManager;
        assertTypeEquals(databaseImportManager, DatabaseImportManager);

        assertIsValid(importStatusId, 'importStatusId is required');
        this.importStatusId = importStatusId;

        this.awsRegion = awsRegion;
        this.requestId = requestId;
    }

    /**
     * Main processing loop for bulk import.
     * @returns {Promise<void>}
     */
    async processAsync() {
        const importStatusResource = await this.databaseImportManager.getImportStatusResourceWithId({
            importStatusId: this.importStatusId
        });

        if (!importStatusResource) {
            throw new Error(`ImportStatus resource not found: ${this.importStatusId}`);
        }

        try {
            logInfo(
                `Starting bulk import for ${this.importStatusId}`,
                { importStatusId: this.importStatusId, filepath: importStatusResource.filepath }
            );

            importStatusResource.status = 'processing';
            await this.databaseImportManager.updateImportStatusAsync({ importStatusResource });

            // TODO: BAI-220 — S3 NDJSON reader (stream line-by-line, respect range param)
            // TODO: BAI-221 — Server-side pacing and rate control for MongoDB writes
            // TODO: BAI-223 — OperationOutcome error file (write per-resource failures to S3)
            // TODO: BAI-225 — ifNoneExist duplicate-prevention wrapper support
            // TODO: BAI-226 — Failure handling (S3 read retries, stalled-operation detection)

            importStatusResource.status = 'completed';
            await this.databaseImportManager.updateImportStatusAsync({ importStatusResource });

            logInfo(
                `Bulk import completed for ${this.importStatusId}`,
                { importStatusId: this.importStatusId }
            );
        } catch (e) {
            logError(
                `Bulk import failed for ${this.importStatusId}: ${e.message}`,
                { importStatusId: this.importStatusId, error: e }
            );

            importStatusResource.status = 'failed';
            importStatusResource.error = e.message;
            await this.databaseImportManager.updateImportStatusAsync({ importStatusResource });

            throw e;
        }
    }
}

module.exports = { BulkDataImportRunner };
