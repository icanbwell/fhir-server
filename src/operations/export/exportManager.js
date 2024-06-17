const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { ForbiddenError } = require('../../utils/httpErrors');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { SecurityTagManager } = require('../common/securityTagManager');
const { assertTypeEquals } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { K8sClient } = require('../../utils/k8sClient');
const { logError, logInfo } = require('../../operations/common/logging');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { ConfigManager } = require('../../utils/configManager');

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
     * @property {import('../../fhir/classes/4_0_0/resources/parameters')} parametersResource
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     *
     * @param {GenerateExportStatusResourceAsyncParams}
     */
    async generateExportStatusResourceAsync({ parametersResource, requestInfo }) {
        const { scope, user, originalUrl, host } = requestInfo;

        // Create ExportStatus resource
        /**
         * @type {import('../../fhir/classes/4_0_0/custom_resources/exportStatus')}
         */
        const exportStatusResource = FhirResourceCreator.createByResourceType(
            {
                id: parametersResource.id,
                resourceType: 'ExportStatus',
                meta: parametersResource.meta.toJSONInternal(),
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

        // If access tag is not present in the resource then copy owner tag to access tag
        if (
            !exportStatusResource.meta.security.some((s) => s.system === SecurityTagSystem.access)
        ) {
            exportStatusResource.meta.security.push(
                new Coding({
                    system: SecurityTagSystem.access,
                    code: exportStatusResource.meta.security.find(
                        (s) => s.system === SecurityTagSystem.owner
                    ).code
                })
            );
        }

        await this.preSaveManager.preSaveAsync({ resource: exportStatusResource });

        return exportStatusResource;
    }

    /**
     * @typedef {Object} ValidateSecurityTagsParams
     * @property {string} user
     * @property {string} scope
     * @property {import('../../fhir/classes/4_0_0/resources/parameters')} parametersResource
     *
     * @param {ValidateSecurityTagsParams}
     */
    validateSecurityTags({ user, scope, parametersResource }) {
        // check if all the access tags and owner tag have codes from the access codes present in scope
        const accessCodesFromScopes = this.securityTagManager.getSecurityTagsFromScope({
            user,
            scope,
            accessRequested: 'read'
        });

        // if access is present as * then skip this check
        if (accessCodesFromScopes.length === 0) {
            return;
        }

        // validate access codes in security tag
        const accessCodesFromSecurityTags = parametersResource.meta.security
            .filter((s) => s.system === SecurityTagSystem.access)
            .map((s) => s.code);

        const invalidAccessCodes = accessCodesFromSecurityTags
            .filter(code => !accessCodesFromScopes.includes(code));

        if (invalidAccessCodes.length > 0) {
            throw new ForbiddenError(`User ${user} cannot trigger Bulk Export with access tags: ${invalidAccessCodes}`);
        }

        // validate owner tag present in security
        const ownerCode = parametersResource.meta.security.find(s => s.system === SecurityTagSystem.owner).code;
        if (!accessCodesFromScopes.includes(ownerCode)) {
            throw new ForbiddenError(
                `User ${user} cannot trigger Bulk Export with owner tag: ${ownerCode}`
            );
        }
    }
    async triggerExportJob({ exportStatusId }) {
        try {
            await this.k8sClient.createJob(
                'node /srv/src/src/operations/export/script/bulkDataExport.js ' +
                `--exportStatusId ${exportStatusId} ` +
                `--bulkExportS3BucketName ${this.configManager.bulkExportS3BucketName} ` +
                `--awsRegion ${this.configManager.awsRegion}`
            );
            logInfo(`Successfully triggered k8sclient Job for ${exportStatusId}`);
        }
        catch (error) {
            logError(`Error in ExportManager triggerExportJob ${error.message}`);
            throw new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        diagnostics: error.message,
                        error: error
                    }
                    )
                ]
            }
            )
        }
    }
}

module.exports = { ExportManager };
