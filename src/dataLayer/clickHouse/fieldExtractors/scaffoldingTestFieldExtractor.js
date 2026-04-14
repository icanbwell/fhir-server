'use strict';

/**
 * Field extractor for ScaffoldingTestResource — a synthetic resource
 * used only for integration testing the ClickHouse-only scaffolding.
 *
 * NOT a real FHIR resource. Exercises all column types the generic
 * infrastructure supports: string, datetime, lowcardinality, number,
 * array, and the _fhir_resource JSON blob.
 */
class ScaffoldingTestFieldExtractor {
    /**
     * Extracts a flat ClickHouse row from a FHIR-like resource.
     *
     * @param {Object} resource - FHIR resource (or test resource)
     * @returns {Object} Flat row keyed by ClickHouse column names
     */
    extract (resource) {
        const meta = resource.meta || {};
        const security = meta.security || [];

        return {
            id: resource.id || '',
            _uuid: resource._uuid || resource.id || '',
            _sourceId: resource._sourceId || `${resource.resourceType}/${resource.id}`,
            recorded: resource.recorded || new Date().toISOString(),
            type_code: resource.type_code || resource.type || '',
            subject_reference: resource.subject_reference || resource.subject?.reference || '',
            value_quantity: resource.value_quantity != null ? resource.value_quantity : null,
            status: resource.status || '',
            access_tags: this._extractSecurityCodes(security, 'https://www.icanbwell.com/access'),
            owner_tags: this._extractSecurityCodes(security, 'https://www.icanbwell.com/owner'),
            source_assigning_authority: resource._sourceAssigningAuthority ||
                this._extractFirstCode(security, 'https://www.icanbwell.com/owner') || '',
            _fhir_resource: typeof resource.toJSON === 'function'
                ? JSON.stringify(resource.toJSON())
                : JSON.stringify(resource)
        };
    }

    /**
     * @param {Array} security
     * @param {string} system
     * @returns {string[]}
     * @private
     */
    _extractSecurityCodes (security, system) {
        return security
            .filter(s => s.system === system)
            .map(s => s.code)
            .filter(Boolean);
    }

    /**
     * @param {Array} security
     * @param {string} system
     * @returns {string|null}
     * @private
     */
    _extractFirstCode (security, system) {
        const tag = security.find(s => s.system === system);
        return tag ? tag.code : null;
    }
}

module.exports = { ScaffoldingTestFieldExtractor };
