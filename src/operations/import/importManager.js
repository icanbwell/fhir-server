const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { SecurityTagManager } = require('../common/securityTagManager');
const { assertTypeEquals } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { ConfigManager } = require('../../utils/configManager');
const { K8sClient } = require('../../utils/k8sClient');
const { generateUUID } = require('../../utils/uid.util');
const { PreSaveOptions } = require('../../preSaveHandlers/preSaveOptions');
const { logInfo } = require('../common/logging');

class ImportManager {
    /**
     * @typedef {Object} ConstructorParams
     * @property {SecurityTagManager} securityTagManager
     * @property {PreSaveManager} preSaveManager
     * @property {ConfigManager} configManager
     * @property {K8sClient} k8sClient
     *
     * @param {ConstructorParams}
     */
    constructor({ securityTagManager, preSaveManager, configManager, k8sClient }) {
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.k8sClient = k8sClient;
        assertTypeEquals(k8sClient, K8sClient);
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

    async triggerImportJob({ importStatusResource, requestId }) {
        let scriptCommand =
            'node /srv/src/src/operations/import/script/bulkDataImport.js ' +
            `--importStatusId ${importStatusResource._uuid} ` +
            `--requestId ${requestId} ` +
            `--awsRegion ${this.configManager.awsRegion}`;

        const jobResult = await this.k8sClient.createJob({
            scriptCommand,
            context: {
                filepath: importStatusResource.filepath
            }
        });
        logInfo(`Successfully triggered k8s Job for import ${importStatusResource._uuid}`);
        return jobResult;
    }
}

module.exports = { ImportManager };
