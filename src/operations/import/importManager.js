const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { SecurityTagManager } = require('../common/securityTagManager');
const { assertTypeEquals } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { ConfigManager } = require('../../utils/configManager');
const { generateUUID } = require('../../utils/uid.util');
const { PreSaveOptions } = require('../../preSaveHandlers/preSaveOptions');
const { DatabaseImportManager } = require('../../dataLayer/databaseImportManager');
const { logInfo, logError } = require('../common/logging');

class ImportManager {
    /**
     * @typedef {Object} ConstructorParams
     * @property {SecurityTagManager} securityTagManager
     * @property {PreSaveManager} preSaveManager
     * @property {ConfigManager} configManager
     * @property {DatabaseImportManager} databaseImportManager
     *
     * @param {ConstructorParams}
     */
    constructor({ securityTagManager, preSaveManager, configManager, databaseImportManager }) {
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.databaseImportManager = databaseImportManager;
        assertTypeEquals(databaseImportManager, DatabaseImportManager);
    }

    /**
     * @typedef {Object} GenerateImportStatusResourceAsyncParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {string} filepath
     * @property {Object} [range]
     *
     * @param {GenerateImportStatusResourceAsyncParams}
     * @returns {Promise<import('../../fhir/classes/4_0_0/custom_resources/importStatus')>}
     */
    async generateImportStatusResourceAsync({ requestInfo, filepath, range }) {
        const { scope, user, originalUrl, host } = requestInfo;

        const importStatusResource = FhirResourceCreator.createByResourceType(
            {
                id: generateUUID(),
                resourceType: 'ImportStatus',
                meta: {
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'bwell'
                        }
                    ],
                    source: 'https://www.icanbwell.com/fhir-server'
                },
                scope,
                user,
                filepath,
                range: range || undefined,
                transactionTime: new Date().toISOString(),
                status: 'accepted',
                request: `${host.startsWith('localhost') ? 'http://' : 'https://'}${host}${originalUrl}`,
                outcome: [],
                resourcesProcessed: 0,
                resourcesFailed: 0,
                totalResources: 0
            },
            'ImportStatus'
        );

        const accessCodesFromScopes = this.securityTagManager.getSecurityTagsFromScope({
            user,
            scope,
            accessRequested: 'write'
        });

        accessCodesFromScopes.forEach((code) => {
            importStatusResource.meta.security.push(
                new Coding({
                    system: SecurityTagSystem.access,
                    code: code
                })
            );
        });

        await this.preSaveManager.preSaveAsync({
            resource: importStatusResource,
            options: PreSaveOptions.fromRequestInfo(requestInfo)
        });

        return importStatusResource;
    }

    /**
     * Kicks off async import processing. This method is intentionally not awaited
     * by the caller — it runs in the background after the 202 response is sent.
     * Subsequent subtasks (BAI-220, BAI-221) will implement the actual S3 reading
     * and MongoDB writing logic here.
     *
     * @typedef {Object} ProcessImportAsyncParams
     * @property {import('../../fhir/classes/4_0_0/custom_resources/importStatus')} importStatusResource
     * @property {string} requestId
     *
     * @param {ProcessImportAsyncParams}
     */
    async processImportAsync({ importStatusResource, requestId }) {
        try {
            logInfo(
                `Starting async import processing for ${importStatusResource.id}`,
                { importStatusId: importStatusResource.id, requestId }
            );

            importStatusResource.status = 'processing';
            await this.databaseImportManager.updateImportStatusAsync({ importStatusResource });

            // TODO: BAI-220 — S3 NDJSON reader (stream line-by-line, respect range param)
            // TODO: BAI-221 — Server-side pacing and rate control for MongoDB writes
            // TODO: BAI-223 — OperationOutcome error file (write per-resource failures to S3)
            // TODO: BAI-225 — ifNoneExist duplicate-prevention wrapper support
            // TODO: BAI-226 — Failure handling (S3 read retries, stalled-operation detection)

        } catch (e) {
            logError(
                `Import processing failed for ${importStatusResource.id}: ${e.message}`,
                { importStatusId: importStatusResource.id, requestId, error: e }
            );

            try {
                importStatusResource.status = 'failed';
                importStatusResource.error = e.message;
                await this.databaseImportManager.updateImportStatusAsync({ importStatusResource });
            } catch (updateErr) {
                logError(
                    `Failed to update ImportStatus after error: ${updateErr.message}`,
                    { importStatusId: importStatusResource.id, error: updateErr }
                );
            }
        }
    }
}

module.exports = { ImportManager };
