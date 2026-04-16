'use strict';

const {
    WRITE_STRATEGIES,
    ENGINE_TYPES,
    RESOURCE_COLUMN_TYPES
} = require('../../../constants/clickHouseConstants');
const { ObservationFieldExtractor } = require('../fieldExtractors/observationFieldExtractor');

// Max date range per query (days). Prevents full-table scans.
// 90 days covers a quarter of data, aligns with monthly partitioning
// (max 3 partitions scanned), and is the standard clinical reporting window.
const MAX_OBSERVATION_RANGE_DAYS = 90;

/**
 * ClickHouse schema definition for FHIR Observation resources.
 *
 * Targets wearable device telemetry (vital signs, continuous monitoring).
 * ReplacingMergeTree for at-least-once delivery dedup.
 * Deployed on a dedicated FHIR server instance.
 */
function getObservationSchema () {
    return {
        resourceType: 'Observation',
        tableName: 'fhir.Observation_4_0_0',
        engine: ENGINE_TYPES.REPLACING_MERGE_TREE,
        versionColumn: 'meta_version_id',
        dedupKey: ['subject_reference', 'code_code', 'effective_datetime'],
        seekKey: ['subject_reference', 'code_code', 'effective_datetime', 'id'],
        fhirResourceColumn: '_fhir_resource',
        fhirResourceColumnType: RESOURCE_COLUMN_TYPES.STRING,
        fieldMappings: {
            effectiveDateTime: { column: 'effective_datetime', type: 'datetime' },
            'code.coding.code': { column: 'code_code', type: 'lowcardinality' },
            'code.coding.system': { column: 'code_system', type: 'lowcardinality' },
            'category.coding.code': { column: 'category_code', type: 'lowcardinality' },
            status: { column: 'status', type: 'lowcardinality' },
            'subject.reference': { column: 'subject_reference', type: 'reference' },
            'device.reference': { column: 'device_reference', type: 'reference' },
            'encounter.reference': { column: 'encounter_reference', type: 'reference' },
            'meta.lastUpdated': { column: 'meta_last_updated', type: 'datetime' }
        },
        securityMappings: {
            accessTags: 'access_tags',
            ownerTags: 'owner_tags',
            sourceAssigningAuthority: 'source_assigning_authority'
        },
        requiredFilters: ['subject.reference', 'code.coding.code', 'effectiveDateTime'],
        maxRangeDays: MAX_OBSERVATION_RANGE_DAYS,
        writeStrategy: WRITE_STRATEGIES.SYNC_DIRECT,
        fireChangeEvents: false, // Disabled until downstream consumer capacity confirmed
        fieldExtractor: new ObservationFieldExtractor()
    };
}

module.exports = { getObservationSchema };
