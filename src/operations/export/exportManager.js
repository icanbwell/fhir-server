const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { SecurityTagManager } = require('../common/securityTagManager');
const { assertTypeEquals } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { K8sClient } = require('../../utils/k8sClient');
const { logInfo } = require('../../operations/common/logging');
const { ConfigManager } = require('../../utils/configManager');
const { generateUUID } = require('../../utils/uid.util');

class ExportManager {
    /**
     * @typedef {Object} ConstructorParams
     * @property {SecurityTagManager} securityTagManager
     * @property {PreSaveManager} preSaveManager
     * @property {ConfigManager} configManager
     * @property {K8sClient} k8sClient
     * @param {ConstructorParams}
     */
    constructor({ securityTagManager, preSaveManager, configManager, k8sClient }) {
        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {K8sClient}
         */
        this.k8sClient = k8sClient;
        assertTypeEquals(k8sClient, K8sClient);
    }

    /**
     * @typedef {Object} GenerateExportStatusResourceAsyncParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     *
     * @param {GenerateExportStatusResourceAsyncParams}
     */
    async generateExportStatusResourceAsync({ requestInfo }) {
        const { scope, user, originalUrl, host } = requestInfo;

        // Create ExportStatus resource
        /**
         * @type {import('../../fhir/classes/4_0_0/custom_resources/exportStatus')}
         */
        const exportStatusResource = FhirResourceCreator.createByResourceType(
            {
                id: generateUUID(),
                resourceType: 'ExportStatus',
                meta: {
                    security: [
                        {
                            system: "https://www.icanbwell.com/owner",
                            code: "bwell"
                        }
                    ],
                    source: "https://www.icanbwell.com/fhir-server"
                },
                scope,
                user,
                transactionTime: new Date().toISOString(),
                requiresAccessToken: false,
                status: 'accepted',
                request: `${host.startsWith('localhost') ? 'http://' : 'https://'}${host}${originalUrl}`,
                output: [],
                errors: []
            },
            'ExportStatus'
        );

        // Copy access tags from scope
        const accessCodesFromScopes = this.securityTagManager.getSecurityTagsFromScope({
            user,
            scope,
            accessRequested: 'read'
        });

        accessCodesFromScopes.forEach((code) => {
            exportStatusResource.meta.security.push(
                new Coding({
                    system: SecurityTagSystem.access,
                    code: code
                })
            );
        });

        await this.preSaveManager.preSaveAsync({ resource: exportStatusResource });

        return exportStatusResource;
    }

    async triggerExportJob({ exportStatusId }) {
        const jobResult = await this.k8sClient.createJob(
            'node /srv/src/src/operations/export/script/bulkDataExport.js ' +
            `--exportStatusId ${exportStatusId} ` +
            `--bulkExportS3BucketName ${this.configManager.bulkExportS3BucketName} ` +
            `--awsRegion ${this.configManager.awsRegion}`
        );
        logInfo(`Successfully triggered k8sclient Job for ${exportStatusId}`);
        return jobResult;
    }
}

module.exports = { ExportManager };
