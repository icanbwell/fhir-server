const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { SecurityTagManager } = require('../common/securityTagManager');
const { assertTypeEquals } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { K8sClient } = require('../../utils/k8sClient');
const { logInfo, logWarn } = require('../../operations/common/logging');
const { ConfigManager } = require('../../utils/configManager');
const { generateUUID } = require('../../utils/uid.util');
const { PreSaveOptions } = require('../../preSaveHandlers/preSaveOptions');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const { isTrue } = require('../../utils/isTrue');

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
     * @param {Object} args
     *
     * @param {GenerateExportStatusResourceAsyncParams}
     */
    async generateExportStatusResourceAsync({ requestInfo, args }) {
        const { scope, user, originalUrl, host } = requestInfo;

        const ignoredParams = [
            'id',
            'base_version',
            'resource',
            'handling',
            '_type',
            'patient',
            '_since',
            'useExternalStorage'  // Prevent query param from bypassing header check
        ];

        // Store useExternalStorage header value for checking during background export
        const useExternalStorage = isTrue(requestInfo?.headers?.[USE_EXTERNAL_STORAGE_HEADER]);

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
                            system: 'https://www.icanbwell.com/owner',
                            code: 'bwell'
                        }
                    ],
                    source: 'https://www.icanbwell.com/fhir-server'
                },
                extension: [
                    ...Object.entries(args)
                        .filter(([key]) => !ignoredParams.includes(key))
                        .map(([key, value]) => ({
                            id: key,
                            url: `https://icanbwell.com/codes/${key}`,
                            valueString: value
                        })),
                    // Store useExternalStorage header for checking during background export
                    ...(useExternalStorage ? [{
                        id: 'useExternalStorage',
                        url: 'https://icanbwell.com/codes/useExternalStorage',
                        valueString: 'true'
                    }] : [])
                ],
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

        await this.preSaveManager.preSaveAsync({
            resource: exportStatusResource,
            options: PreSaveOptions.fromRequestInfo(requestInfo)
        });

        return exportStatusResource;
    }

    async triggerExportJob({ exportStatusResource, requestId }) {
        const context = exportStatusResource.extension?.reduce((dict, currentValue) => {
            dict[currentValue.id] = currentValue.valueString;
            return dict;
        }, {}) || {};

        let scriptCommand =
            'node /srv/src/src/operations/export/script/bulkDataExport.js ' +
            `--exportStatusId ${exportStatusResource._uuid} ` +
            `--bulkExportS3BucketName ${this.configManager.bulkExportS3BucketName} ` +
            `--requestId ${requestId} ` +
            `--awsRegion ${this.configManager.awsRegion}`;

        // These are batch-size tuning knobs and must be plain positive integers. `context[param]`
        // originates from a request-supplied query param (persisted onto the ExportStatus
        // resource as an extension). scriptCommand is later split on spaces into the container's
        // argv array (see K8sClient.createJobBody), so an unvalidated value containing a space
        // could inject additional/overriding CLI flags into the spawned job. Silently drop any
        // value that isn't a bare non-negative integer rather than passing it through.
        const possibleScriptParams = ['patientReferenceBatchSize', 'fetchResourceBatchSize', 'uploadPartSize'];
        const INTEGER_PARAM_RE = /^[0-9]+$/;
        possibleScriptParams.forEach(param => {
            const value = context[param];
            if (value === undefined || value === null || value === '') {
                return;
            }
            if (INTEGER_PARAM_RE.test(String(value))) {
                scriptCommand += ` --${param} ${value}`;
            } else {
                logWarn(`Ignoring non-integer value for export job param '${param}'`, { exportStatusId: exportStatusResource._uuid });
            }
        });

        const jobResult = await this.k8sClient.createJob({
            scriptCommand,
            context
        });
        logInfo(`Successfully triggered k8sclient Job for ${exportStatusResource._uuid}`);
        return jobResult;
    }
}

module.exports = { ExportManager };
