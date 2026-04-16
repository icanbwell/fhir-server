'use strict';

const { DateTimeFormatter } = require('../../../utils/clickHouse/dateTimeFormatter');

// LOINC codes for BP panel and components
const LOINC_SYSTEM = 'http://loinc.org';
const BP_PANEL_CODE = '85354-9';
const SYSTOLIC_CODE = '8480-6';
const DIASTOLIC_CODE = '8462-4';

/**
 * Extracts a flat ClickHouse row from a FHIR Observation resource.
 *
 * Handles vital signs including blood pressure panels with
 * systolic/diastolic components and dataAbsentReason.
 */
class ObservationFieldExtractor {
    /**
     * @param {Object} resource - FHIR Observation resource
     * @returns {Object} Flat row keyed by ClickHouse column names
     */
    extract (resource) {
        const meta = resource.meta || {};
        const security = meta.security || [];
        const coding = this._getFirstCoding(resource.code);
        const categoryCoding = this._getCategoryCoding(resource.category);
        const isBP = coding.system === LOINC_SYSTEM && coding.code === BP_PANEL_CODE;

        const row = {
            id: resource.id || '',
            _uuid: resource._uuid || resource.id || '',
            _sourceId: resource._sourceId || (resource.id ? `Observation/${resource.id}` : ''),
            meta_version_id: this._parseVersionId(meta.versionId),
            effective_datetime: DateTimeFormatter.toClickHouseDateTime(
                resource.effectiveDateTime || new Date().toISOString()
            ),
            code_code: coding.code,
            code_system: coding.system,
            category_code: categoryCoding.code,
            status: resource.status || '',
            subject_reference: resource.subject?.reference || '',
            device_reference: resource.device?.reference || '',
            encounter_reference: resource.encounter?.reference || '',
            value_quantity_value: null,
            value_quantity_unit: '',
            value_quantity_code: '',
            component_systolic: null,
            component_diastolic: null,
            access_tags: this._extractSecurityCodes(security, 'https://www.icanbwell.com/access'),
            owner_tags: this._extractSecurityCodes(security, 'https://www.icanbwell.com/owner'),
            source_assigning_authority: this._extractFirstCode(security, 'https://www.icanbwell.com/owner') || '',
            meta_last_updated: DateTimeFormatter.toClickHouseDateTime(
                meta.lastUpdated || new Date().toISOString()
            ),
            meta_source: meta.source || '',
            _fhir_resource: typeof resource.toJSON === 'function'
                ? JSON.stringify(resource.toJSON())
                : JSON.stringify(resource)
        };

        if (isBP) {
            this._extractBPComponents(resource.component, row);
        } else {
            this._extractValueQuantity(resource.valueQuantity, row);
        }

        return row;
    }

    /**
     * Extracts valueQuantity for non-BP observations.
     * @param {Object|undefined} valueQuantity
     * @param {Object} row - mutated
     * @private
     */
    _extractValueQuantity (valueQuantity, row) {
        if (!valueQuantity) return;
        row.value_quantity_value = valueQuantity.value != null ? valueQuantity.value : null;
        row.value_quantity_unit = valueQuantity.unit || '';
        row.value_quantity_code = valueQuantity.code || '';
    }

    /**
     * Extracts systolic and diastolic values from BP panel components.
     * Handles dataAbsentReason (component present but value missing).
     *
     * @param {Array|undefined} components - Observation.component[]
     * @param {Object} row - mutated
     * @private
     */
    _extractBPComponents (components, row) {
        if (!Array.isArray(components)) return;

        for (const component of components) {
            if (!component || !component.code) continue;
            const componentCoding = this._getFirstCoding(component.code);
            if (componentCoding.system !== LOINC_SYSTEM) continue;
            const componentCode = componentCoding.code;

            if (componentCode === SYSTOLIC_CODE) {
                row.component_systolic = component.valueQuantity?.value != null
                    ? component.valueQuantity.value
                    : null;
            } else if (componentCode === DIASTOLIC_CODE) {
                row.component_diastolic = component.valueQuantity?.value != null
                    ? component.valueQuantity.value
                    : null;
            }
        }
    }

    /**
     * @param {Object|undefined} codeableConcept
     * @returns {{ code: string, system: string }}
     * @private
     */
    _getFirstCoding (codeableConcept) {
        const coding = codeableConcept?.coding?.[0];
        return {
            code: coding?.code || '',
            system: coding?.system || ''
        };
    }

    /**
     * @param {Array|undefined} categoryArray
     * @returns {{ code: string }}
     * @private
     */
    _getCategoryCoding (categoryArray) {
        const coding = categoryArray?.[0]?.coding?.[0];
        return { code: coding?.code || '' };
    }

    /**
     * @param {string|undefined} versionId
     * @returns {number}
     * @private
     */
    _parseVersionId (versionId) {
        if (!versionId) return 0;
        const parsed = parseInt(versionId, 10);
        return isNaN(parsed) ? 0 : parsed;
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

module.exports = { ObservationFieldExtractor };
