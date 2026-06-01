#!/usr/bin/env node
/**
 * Generates AuditEvent load test data for the AUDIT_ACCESS_MV materialized view.
 *
 * Queries MongoDB for real resources linked to a patient, then creates audit events
 * simulating an accessor reading those resources. Events are inserted directly into
 * ClickHouse's AuditEvent_4_0_0 table, triggering the MV to populate AUDIT_ACCESS_AGG.
 *
 * Required environment:
 *   ENABLE_CLICKHOUSE=1
 *   CLICKHOUSE_HOST, CLICKHOUSE_PORT, etc.
 *   MONGO_URL (for fetching patient resources)
 *
 * Options:
 *   --accessor <ref>            Who is accessing (e.g., Practitioner/uuid) [required]
 *   --patient-id <uuid>         Patient whose resources to use [required]
 *   --resource-types <list>     Comma-separated resource types (default: Observation,Encounter,Condition)
 *   --count <n>                 AuditEvents per resource (default: 100)
 *   --months <list>             Comma-separated YYYY-MM months [required]
 *   --batch-size <n>            Rows per ClickHouse INSERT (default: 10000)
 *   --purpose <list>            Comma-separated purpose codes (default: empty)
 *   --dry-run                   Show stats without inserting
 *   --help, -h                  Show this help
 *
 * Examples:
 *   ENABLE_CLICKHOUSE=1 node src/admin/scripts/generateAuditAccessLoadData.js \
 *     --accessor "Practitioner/doc-uuid" --patient-id "pat-uuid" --months "2026-04,2026-05"
 *
 *   node src/admin/scripts/generateAuditAccessLoadData.js \
 *     --accessor "Person/person-uuid" --patient-id "pat-uuid" \
 *     --resource-types "Observation,DiagnosticReport" --count 500 \
 *     --months "2026-03,2026-04,2026-05" --purpose "TREAT,HOPERAT"
 *
 * Cleanup:
 *   ALTER TABLE fhir.AuditEvent_4_0_0 DELETE WHERE _sourceAssigningAuthority = 'load-test';
 */

const { createContainer } = require('../../createContainer');
const { logError } = require('../../operations/common/logging');
const { AdminLogger } = require('../adminLogger');
const { GenerateAuditAccessLoadDataRunner } = require('../runners/generateAuditAccessLoadDataRunner');

const PREFIX = 'GenerateAuditAccessLoadData';

const USAGE = `
Usage: node src/admin/scripts/generateAuditAccessLoadData.js [options]

Generates AuditEvent load test data for AUDIT_ACCESS_MV performance testing.
Fetches real resources for a patient from MongoDB, then creates audit events
in ClickHouse simulating the accessor reading those resources.

Required:
  --accessor <ref>            Who is accessing (e.g., Practitioner/uuid, Person/uuid)
  --patient-id <uuid>         Patient UUID whose resources will be accessed
  --months <YYYY-MM,...>      Months to distribute events across (e.g., 2026-03,2026-04)

Options:
  --resource-types <list>     Comma-separated resource types (default: Observation,Encounter,Condition)
  --count <n>                 AuditEvents per resource (default: 10)
  --batch-size <n>            Rows per ClickHouse INSERT batch (default: 10000)
  --purpose <list>            Comma-separated purpose codes (default: empty → MV uses PATRQT)
  --dry-run                   Show resource pool and sample events without inserting
  --help, -h                  Show this help

Cleanup:
  ALTER TABLE fhir.AuditEvent_4_0_0 DELETE WHERE _sourceAssigningAuthority = 'load-test';
`;

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        accessor: null,
        patientId: null,
        resourceTypes: ['Observation', 'Encounter', 'Condition'],
        count: 10,
        months: null,
        batchSize: 10000,
        purpose: [],
        dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--accessor':
                options.accessor = args[++i];
                break;
            case '--patient-id':
                options.patientId = args[++i];
                break;
            case '--resource-types':
                options.resourceTypes = args[++i].split(',').map((s) => s.trim());
                break;
            case '--count':
                options.count = parsePositiveInt('--count', args[++i]);
                break;
            case '--months':
                options.months = parseMonths(args[++i]);
                break;
            case '--batch-size':
                options.batchSize = parsePositiveInt('--batch-size', args[++i]);
                break;
            case '--purpose':
                options.purpose = args[++i].split(',').map((s) => s.trim());
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--help':
            case '-h':
                console.log(USAGE);
                process.exit(0);
        }
    }

    if (!options.accessor) {
        logError(`${PREFIX}: --accessor is required`);
        console.log(USAGE);
        process.exit(1);
    }
    if (!options.patientId) {
        logError(`${PREFIX}: --patient-id is required`);
        console.log(USAGE);
        process.exit(1);
    }
    if (!options.months) {
        logError(`${PREFIX}: --months is required`);
        console.log(USAGE);
        process.exit(1);
    }

    return options;
}

function parsePositiveInt(flag, raw) {
    if (raw === undefined || raw.startsWith('--')) {
        logError(`${PREFIX}: ${flag} requires a positive integer argument`);
        process.exit(1);
    }
    const value = parseInt(raw, 10);
    if (!Number.isInteger(value) || value <= 0) {
        logError(`${PREFIX}: ${flag} requires a positive integer, got: ${raw}`);
        process.exit(1);
    }
    return value;
}

function parseMonths(raw) {
    if (!raw) {
        logError(`${PREFIX}: --months requires a comma-separated list of YYYY-MM values`);
        process.exit(1);
    }
    const months = raw.split(',').map((s) => s.trim());
    for (const m of months) {
        if (!/^\d{4}-\d{2}$/.test(m)) {
            logError(`${PREFIX}: --months: invalid format "${m}", expected YYYY-MM`);
            process.exit(1);
        }
    }
    return months;
}

async function main() {
    const options = parseArgs();

    const container = createContainer();

    const runner = new GenerateAuditAccessLoadDataRunner({
        adminLogger: new AdminLogger(),
        mongoDatabaseManager: container.mongoDatabaseManager,
        patientFilterManager: container.patientFilterManager,
        databaseQueryFactory: container.databaseQueryFactory,
        preSaveManager: container.preSaveManager,
        clickHouseClientManager: container.clickHouseClientManager,
        accessor: options.accessor,
        patientId: options.patientId,
        resourceTypes: options.resourceTypes,
        count: options.count,
        months: options.months,
        batchSize: options.batchSize,
        purpose: options.purpose,
        dryRun: options.dryRun
    });

    try {
        return await runner.processAsync();
    } finally {
        if (container.clickHouseClientManager) {
            await container.clickHouseClientManager.closeAsync();
        }
    }
}

if (require.main === module) {
    main()
        .then((code) => {
            process.exit(code);
        })
        .catch((error) => {
            logError(`${PREFIX}: Fatal error`, { error: error.message, stack: error.stack });
            process.exit(1);
        });
}

module.exports = { parseArgs, parsePositiveInt, parseMonths };
