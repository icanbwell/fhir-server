'use strict';

const path = require('path');
const fs = require('fs');

// Set env vars FIRST, before any requires that trigger DI container creation
process.env.ENABLE_CLICKHOUSE = '1';
process.env.CLICKHOUSE_ONLY_RESOURCES = 'AuditEvent';
process.env.CLICKHOUSE_DATABASE = 'fhir';
process.env.LOGLEVEL = 'SILENT';
process.env.STREAM_RESPONSE = '0';

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getHeadersWithCustomPayload } = require('../../common');
const { ClickHouseClientManager } = require('../../../utils/clickHouseClientManager');
const { ConfigManager } = require('../../../utils/configManager');
const { ClickHouseTestContainer } = require('../../clickHouseTestContainer');
const { generateUUIDv5 } = require('../../../utils/uid.util');

const AUDIT_EVENT_SCHEMA_PATH = path.join(__dirname, '../../../../clickhouse-init/02-audit-event.sql');

let sharedRequest = null;
let sharedClickHouseManager = null;
let isSetupComplete = false;
let setupPromise = null;
let clickHouseTestContainer = null;
let savedContainerEnvVars = null;

async function waitForClickHouse (manager, maxWaitMs = 30000) {
    const startTime = Date.now();
    let delay = 100;
    while (Date.now() - startTime < maxWaitMs) {
        try {
            await manager.getClientAsync();
            const isHealthy = await manager.isHealthyAsync();
            if (isHealthy) return true;
        } catch (e) {
            // retry
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 1000);
    }
    throw new Error(`ClickHouse not ready after ${maxWaitMs}ms`);
}

async function loadAuditEventSchema (manager) {
    const tableExists = await manager.tableExistsAsync('AuditEvent_4_0_0');
    if (!tableExists) {
        const schemaSQL = fs.readFileSync(AUDIT_EVENT_SCHEMA_PATH, 'utf8');
        const statements = schemaSQL
            .split(';')
            .map(s => s.replace(/--.*$/gm, '').trim())
            .filter(s => s.length > 0)
            .filter(s => !s.startsWith('SET '));

        const client = await manager.getClientAsync();
        for (const stmt of statements) {
            await client.query({
                query: stmt,
                clickhouse_settings: { allow_experimental_json_type: 1 }
            });
        }
    }
}

async function setupAuditEventClickHouseTests () {
    if (setupPromise) return setupPromise;
    if (isSetupComplete) return;

    setupPromise = (async () => {
        try {
            if (!clickHouseTestContainer) {
                clickHouseTestContainer = new ClickHouseTestContainer();
                await clickHouseTestContainer.start({ startupTimeoutMs: 60000 });
                savedContainerEnvVars = clickHouseTestContainer.applyEnvVars();
            }

            await commonBeforeEach();

            const configManager = new ConfigManager();
            sharedClickHouseManager = new ClickHouseClientManager({ configManager });
            await waitForClickHouse(sharedClickHouseManager, 30000);

            await loadAuditEventSchema(sharedClickHouseManager);

            sharedRequest = await createTestRequest();

            isSetupComplete = true;
        } catch (error) {
            setupPromise = null;
            throw error;
        }
    })();

    return setupPromise;
}

async function teardownAuditEventClickHouseTests () {
    if (!isSetupComplete) return;

    try {
        if (sharedClickHouseManager) {
            await sharedClickHouseManager.closeAsync();
            sharedClickHouseManager = null;
        }

        if (clickHouseTestContainer) {
            if (savedContainerEnvVars) {
                clickHouseTestContainer.restoreEnvVars(savedContainerEnvVars);
                savedContainerEnvVars = null;
            }
            await clickHouseTestContainer.stop();
            clickHouseTestContainer = null;
        }

        await commonAfterEach();
        sharedRequest = null;
        isSetupComplete = false;
        setupPromise = null;
    } catch (error) {
        console.error('Error during teardown:', error);
        throw error;
    }
}

async function cleanupBetweenTests () {
    await commonBeforeEach();
    if (sharedClickHouseManager) {
        try {
            await sharedClickHouseManager.queryAsync({
                query: 'TRUNCATE TABLE IF EXISTS fhir.AuditEvent_4_0_0'
            });
        } catch (e) {
            // ignore
        }
    }
}

const DEFAULT_AGENT_WHO_UUID = 'Practitioner/00000000-0000-4000-8000-000000000001';
const DEFAULT_ENTITY_WHAT_UUID = 'Patient/00000000-0000-4000-8000-000000000002';

function makeAuditEvent (overrides = {}) {
    const id = overrides.id || `ae-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ownerCode = overrides.ownerCode || 'org-1';
    const uuid = overrides._uuid || generateUUIDv5(`${id}|${ownerCode}`);
    const recorded = overrides.recorded || '2024-06-15 10:30:00.000';
    const recordedISO = overrides.recordedISO || '2024-06-15T10:30:00.000Z';
    const action = overrides.action || 'R';
    const agentWho = overrides.agent_who || [DEFAULT_AGENT_WHO_UUID];
    const agentAltid = overrides.agent_altid || ['dr-smith'];
    const entityWhat = overrides.entity_what || [DEFAULT_ENTITY_WHAT_UUID];
    const agentWhoSourceId = overrides.agent_who_sourceId || agentWho;
    const entityWhatSourceId = overrides.entity_what_sourceId || entityWhat;
    const accessTags = overrides.access_tags || ['client-a'];
    const outcome = overrides.outcome || '0';

    return {
        id,
        _uuid: uuid,
        recorded,
        action,
        agent_who: agentWho,
        agent_altid: agentAltid,
        entity_what: entityWhat,
        agent_requestor_who: agentWho[0] || '',
        purpose_of_event: [],
        meta_security: [
            { system: 'https://www.icanbwell.com/access', code: accessTags[0] || 'client-a' },
            { system: 'https://www.icanbwell.com/owner', code: ownerCode }
        ],
        access_tags: accessTags,
        _sourceAssigningAuthority: ownerCode,
        _sourceId: id,
        resource: {
            resourceType: 'AuditEvent',
            id,
            _uuid: uuid,
            recorded: recordedISO,
            action,
            outcome,
            type: {
                system: 'http://dicom.nema.org/resources/ontology/DCM',
                code: '110112',
                display: 'Query'
            },
            subtype: [{ system: 'http://hl7.org/fhir/restful-interaction', code: 'search-type', display: 'search' }],
            agent: agentWho.map((ref, i) => ({
                who: {
                    _uuid: ref,
                    reference: agentWhoSourceId[i] || ref,
                    _sourceId: agentWhoSourceId[i] || ref
                },
                altId: agentAltid[i] || '',
                requestor: i === 0
            })),
            entity: entityWhat.map((ref, i) => ({
                what: {
                    _uuid: ref,
                    reference: entityWhatSourceId[i] || ref,
                    _sourceId: entityWhatSourceId[i] || ref
                }
            })),
            source: {
                site: 'https://access.example.org',
                observer: { reference: 'Organization/TestOrg' }
            },
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: accessTags[0] || 'client-a' },
                    { system: 'https://www.icanbwell.com/owner', code: ownerCode }
                ]
            },
            _sourceAssigningAuthority: ownerCode,
            _sourceId: id
        }
    };
}

async function insertRows (rows) {
    await sharedClickHouseManager.insertAsync({
        table: 'fhir.AuditEvent_4_0_0',
        values: rows,
        format: 'JSONEachRow'
    });
}

function getSharedRequest () { return sharedRequest; }
function getClickHouseManager () { return sharedClickHouseManager; }
function getTestHeaders (scope) { return getHeaders(scope); }
function getTestHeadersWithCustomPayload (payload) { return getHeadersWithCustomPayload(payload); }

module.exports = {
    setupAuditEventClickHouseTests,
    teardownAuditEventClickHouseTests,
    cleanupBetweenTests,
    getSharedRequest,
    getClickHouseManager,
    getTestHeaders,
    getTestHeadersWithCustomPayload,
    makeAuditEvent,
    insertRows
};
