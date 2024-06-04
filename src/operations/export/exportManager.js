const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { SecurityTagManager } = require('../common/securityTagManager');
const { assertTypeEquals } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');

class ExportManager {
    /**
     * @typedef {Object} ConstructorParams
     * @property {SecurityTagManager} securityTagManager
     * @property {PreSaveManager} preSaveManager
     *
     * @param {ConstructorParams}
     */
    constructor({ securityTagManager, preSaveManager }) {
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
    }

    /**
     * @typedef {Object} GenerateExportStatusResourceAsyncParams
     * @property {import('../../fhir/classes/4_0_0/resources/parameters')} parameterResource
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     *
     * @param {GenerateExportStatusResourceAsyncParams}
     */
    async generateExportStatusResourceAsync({ parameterResource, requestInfo }) {
        const { scope, user, originalUrl } = requestInfo;

        // Create ExportStatus resource
        /**
         * @type {import('../../fhir/classes/4_0_0/custom_resources/exportStatus')}
         */
        const exportStatusResource = FhirResourceCreator.createByResourceType(
            {
                id: parameterResource.id,
                resourceType: 'ExportStatus',
                meta: parameterResource.meta.toJSONInternal(),
                scope,
                user,
                status: 'accepted',
                request: `https://fhir.export${originalUrl}`,
                output: [],
                errors: []
            },
            'ExportStatus'
        );

        // Add accessTags from scope to ExportStatus resource
        const accessCodesFromScope = this.securityTagManager.getSecurityTagsFromScope({
            user,
            scope,
            accessRequested: 'read'
        });

        accessCodesFromScope.forEach((accessCode) =>
            exportStatusResource.meta.push({
                system: SecurityTagSystem.access,
                code: accessCode
            })
        );

        await this.preSaveManager.preSaveAsync({ resource: exportStatusResource });

        return exportStatusResource;
    }
}

module.exports = { ExportManager };
