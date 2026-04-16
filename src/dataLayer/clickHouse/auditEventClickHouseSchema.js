'use strict';

const {
    WRITE_STRATEGIES,
    ENGINE_TYPES,
    RESOURCE_COLUMN_TYPES,
    TABLES
} = require('../../constants/clickHouseConstants');
const { AuditEventFieldExtractor } = require('./auditEventFieldExtractor');

/**
 * Returns the ClickHouse schema definition for AuditEvent.
 *
 * Maps FHIR search parameters to dedicated ClickHouse columns (hot path)
 * and to JSON path expressions on the `resource` native JSON column (cold path).
 *
 * Dedicated columns (fast, indexed):
 *   agent.who._uuid    → agent_who Array(String)
 *   entity.what._uuid  → entity_what Array(String)
 *   agent.altId         → agent_altid Array(String)
 *   recorded            → recorded DateTime64(3, 'UTC')
 *   action              → action LowCardinality(String)
 *
 * JSON path fallbacks (_sourceId lookups query inside resource JSON column):
 *   agent.who._sourceId  → resource.agent[].who._sourceId
 *   entity.what._sourceId → resource.entity[].what._sourceId
 *
 * @returns {Object} Schema definition for ClickHouseSchemaRegistry
 */
function getAuditEventClickHouseSchema () {
    return {
        tableName: TABLES.AUDIT_EVENT,
        engine: ENGINE_TYPES.MERGE_TREE,
        versionColumn: null,
        dedupKey: null,
        seekKey: ['recorded', '_uuid'],
        fhirResourceColumn: 'resource',
        fhirResourceColumnType: RESOURCE_COLUMN_TYPES.JSON,
        fieldMappings: {
            // date search parameter → recorded column (mandatory filter)
            recorded: { column: 'recorded', type: 'datetime' },
            // action search parameter
            action: { column: 'action', type: 'lowcardinality' },
            // agent search parameter — UUID references use dedicated column
            'agent.who._uuid': { column: 'agent_who', type: 'array<string>' },
            // agent _sourceId references query inside the resource JSON column
            'agent.who._sourceId': { column: 'resource.agent[].who._sourceId', type: 'array<string>', jsonPath: true },
            // altid search parameter
            'agent.altId': { column: 'agent_altid', type: 'array<string>' },
            // entity search parameter — UUID references use dedicated column
            'entity.what._uuid': { column: 'entity_what', type: 'array<string>' },
            // entity _sourceId references query inside the resource JSON column
            'entity.what._sourceId': { column: 'resource.entity[].what._sourceId', type: 'array<string>', jsonPath: true }
        },
        securityMappings: {
            accessTags: 'access_tags',
            sourceAssigningAuthority: '_sourceAssigningAuthority'
        },
        requiredFilters: ['recorded'],
        maxRangeDays: 30,
        writeStrategy: WRITE_STRATEGIES.SYNC_DIRECT,
        fireChangeEvents: false,
        fieldExtractor: new AuditEventFieldExtractor()
    };
}

module.exports = { getAuditEventClickHouseSchema };
