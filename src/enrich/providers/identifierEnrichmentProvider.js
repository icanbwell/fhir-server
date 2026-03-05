const { FhirTypesManager } = require('../../fhir/fhirTypesManager');
const { assertTypeEquals } = require('../../utils/assertType');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { EnrichmentProvider } = require('./enrichmentProvider');

class IdentifierEnrichmentProvider extends EnrichmentProvider {
    /**
     * @typedef IdentifierEnrichmentProviderParams
     * @property {FhirTypesManager} fhirTypesManager
     *
     * constructor
     * @param {IdentifierEnrichmentProviderParams} params
     */
    constructor({ fhirTypesManager }) {
        super();
        this.fhirTypesManager = fhirTypesManager;
        assertTypeEquals(fhirTypesManager, FhirTypesManager);
    }

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */
    async enrichAsync({ resources, parsedArgs }) {
        for (const resource of resources) {
            this.enrichIdentifierList(resource);
            if (resource.contained && resource.contained.length > 0) {
                resource.contained = await this.enrichAsync({
                    resources: resource.contained,
                    parsedArgs
                });
            }
        }
        return resources;
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({ entries, parsedArgs }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (
                    await this.enrichAsync({
                        resources: [entry.resource],
                        parsedArgs
                    })
                )[0];
            }
            entry.id = entry.resource.id;
        }
        return entries;
    }

    /**
     * enriches the identifier list of the resource by adding sourceId and uuid if not present
     * @param {Resource} resource
     */
    enrichIdentifierList(resource) {
        if (!resource || typeof resource !== 'object' || !resource.resourceType) return;

        // only enrich if identifier field is present and is of type list
        const resourceIdentifierType = this.fhirTypesManager.getDataForField({
            resourceType: resource.resourceType,
            field: 'identifier'
        });
        if (!resourceIdentifierType || resourceIdentifierType.max !== '*') return;

        const identifiers = resource.identifier || [];

        const resourceUuid = resource?._uuid;
        const resourceSourceId = resource?._sourceId;

        let sourceIdIdentifier = null;
        let uuidIdentifier = null;

        for (const iden of identifiers) {
            if (iden.system === IdentifierSystem.sourceId) {
                sourceIdIdentifier = iden;
            } else if (iden.system === IdentifierSystem.uuid) {
                uuidIdentifier = iden;
            }
        }

        // update sourceId extension if needed
        if (resourceSourceId) {
            if (!sourceIdIdentifier) {
                identifiers.push({
                    id: 'sourceId',
                    system: IdentifierSystem.sourceId,
                    value: resourceSourceId
                });
            } else if (sourceIdIdentifier.value !== resourceSourceId) {
                sourceIdIdentifier.value = resourceSourceId;
            }
        }

        // update uuid extension if needed
        if (resourceUuid) {
            if (!uuidIdentifier) {
                identifiers.push({
                    id: 'uuid',
                    system: IdentifierSystem.uuid,
                    value: resourceUuid
                });
            } else if (uuidIdentifier.value !== resourceUuid) {
                uuidIdentifier.value = resourceUuid;
            }
        }

        if (identifiers.length > 0) {
            resource.identifier = identifiers;
        }
    }
}

module.exports = {
    IdentifierEnrichmentProvider
};
