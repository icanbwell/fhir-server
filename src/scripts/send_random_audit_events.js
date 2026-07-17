#!/usr/bin/env node
/**
 * Generate random FHIR AuditEvents and produce them to the Kafka topic that
 * ClickPipes consumes into `fhir.AuditEvent_4_0_0`.
 *
 * This is the verification producer for the AuditEvent ClickPipe migration
 * (DCON-4304, Ticket 1). It proves, end-to-end, that the Kafka message body
 * format maps correctly onto the ClickHouse table columns — BEFORE the
 * production write path (the KAFKA_CLICKPIPE executor, Ticket 2) is built.
 *
 * IMPORTANT: the Kafka message body is NOT the raw FHIR AuditEvent. ClickPipes
 * maps the TOP-LEVEL JSON keys of each message onto table columns, so the body
 * is the flattened ClickHouse row produced by AuditEventTransformer (the same
 * transformer the production executor will use). Each event is one message,
 * keyed by `_uuid`.
 *
 * KafkaClientV2 builds the kafkajs client with this server's broker/auth
 * configuration (SASL/SCRAM, MSK IAM, SSL) from environment variables, so the
 * messages are produced to the exact same cluster the server talks to. The
 * required environment variables are the same as manage_kafka_v2_topic.js.
 *
 * The destination topic is hardcoded to `fhir_server.resource.AuditEvent_4_0_0`
 * (the topic the AuditEvent ClickPipe consumes into fhir.AuditEvent_4_0_0).
 *
 * Each batch is GZIP-compressed on the wire by default (kafkajs compresses the
 * whole message-set, so larger --batch-size values compress better). The broker
 * stores the batch compressed and the ClickPipe consumer decompresses it
 * transparently. Use --compression none to disable.
 *
 * Usage:
 *   node src/scripts/send_random_audit_events.js [--count N] [--batch-size N] [--compression gzip|none] [--dry-run]
 *
 * Options:
 *   --count        number of random AuditEvents to send (default: 10)
 *   --batch-size   messages per produce call (default: 100)
 *   --compression  message-set codec: gzip (default) or none
 *   --dry-run      print the transformed message JSON to stdout, send nothing
 *
 * Examples:
 *   node src/scripts/send_random_audit_events.js --count 50
 *   node src/scripts/send_random_audit_events.js --count 5 --dry-run
 *   node src/scripts/send_random_audit_events.js --count 50 --compression none
 */

const { parseArgs } = require('node:util');
const { CompressionTypes } = require('kafkajs');

const { KafkaClientV2 } = require('../utils/kafkaClientV2');
const { ConfigManager } = require('../utils/configManager');
const { AuditEventTransformer } = require('../dataLayer/clickHouse/auditEventTransformer');
const { generateUUID } = require('../utils/uid.util');
const { SECURITY_TAG_SYSTEMS } = require('../constants/securityTagSystems');
const { PERSON_PROXY_PREFIX, PURPOSE_OF_USE_SYSTEM } = require('../constants');
const { logInfo, logError } = require('../operations/common/logging');
const { parseIntArg } = require('./manage_kafka_v2_topic');

// Prefix every log line so this script's output is easy to grep out of the
// shared server logs (mirrors manage_kafka_v2_topic.js).
const LOG_PREFIX = '[send_random_audit_events]';
const log = {
    info: (message, args) => logInfo(`${LOG_PREFIX} ${message}`, args),
    error: (message, args) => logError(`${LOG_PREFIX} ${message}`, args)
};

// Hardcoded destination: the Kafka topic the AuditEvent ClickPipe consumes into
// the fhir.AuditEvent_4_0_0 table. Namespaced under the fhir_server. prefix.
const TOPIC = 'fhir_server.resource.AuditEvent_4_0_0';
const DEFAULT_COUNT = 10;
const DEFAULT_BATCH_SIZE = 100;
// GZIP is the only codec bundled with kafkajs (snappy/lz4/zstd need extra
// packages), so it's the safe default for compressing the produced batches.
const DEFAULT_COMPRESSION = 'gzip';

// Map the --compression CLI value to a kafkajs CompressionTypes constant.
// `none` (or the default kafkajs behavior) is represented by undefined, which
// producer.send treats as no compression.
const COMPRESSION_CODECS = {
    none: undefined,
    gzip: CompressionTypes.GZIP
};

/**
 * Resolves the --compression CLI value to a kafkajs CompressionTypes constant.
 * @param {string} value CLI value (defaults to DEFAULT_COMPRESSION)
 * @returns {import('kafkajs').CompressionTypes | undefined}
 */
function parseCompressionArg(value) {
    const key = (value || DEFAULT_COMPRESSION).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(COMPRESSION_CODECS, key)) {
        throw new Error(
            `Invalid --compression '${value}'. Supported: ${Object.keys(COMPRESSION_CODECS).join(', ')}`
        );
    }
    return COMPRESSION_CODECS[key];
}

// recorded is spread over the last week so events land in the current monthly
// partition and well inside the table's 13-month TTL.
const RECORDED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// AuditEvent.action is a fixed FHIR value set (C/R/U/D/E). We only generate
// read events ('R') — the access-history / ClickPipe path this script verifies
// is dominated by reads.
const READ_ACTION = 'R';
const AGENT_RESOURCE_TYPES = ['Patient'];
const ENTITY_RESOURCE_TYPES = ['Patient', 'Observation', 'Condition', 'Encounter'];
const PURPOSE_CODES = ['PATRQT'];
// All generated events originate from the bwell authority; auditLogger stamps
// every AuditEvent with owner=bwell + access=bwell in meta.security.
const SOURCE_ASSIGNING_AUTHORITY = 'bwell';

// Mirror auditLogger.createAuditEntry for a read: DCM "Query" type.
const READ_EVENT_TYPE = {
    system: 'http://dicom.nema.org/resources/ontology/DCM',
    code: '110112',
    display: 'Query'
};

/**
 * The observer organization id, sourced from the same env var auditLogger reads
 * via configManager (AUDIT_EVENT_OBSERVER_ORGANIZATION_ID). Read at call time so
 * the environment can be set per invocation.
 * @returns {string}
 */
function getObserverOrganizationReference() {
    return `Organization/${process.env.AUDIT_EVENT_OBSERVER_ORGANIZATION_ID}`;
}

// Single reusable transformer — the exact code the production executor will use.
const transformer = new AuditEventTransformer();

/**
 * Random integer in [min, max] (both inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Pick a random element from a non-empty array.
 * @param {Array<T>} arr
 * @returns {T}
 * @template T
 */
function pick(arr) {
    return arr[randInt(0, arr.length - 1)];
}

/**
 * Builds a single random — and schema-valid — FHIR AuditEvent for a read.
 *
 * This is a CLEAN FHIR resource: it does NOT carry the bwell-internal
 * `_uuid` / `_sourceId` / `_sourceAssigningAuthority` fields (those are added by
 * enrichAuditEvent when the Kafka message is built, mirroring how the write path
 * adds them in preSave). Keeping this clean lets the resource pass FHIR schema
 * validation. Mirrors auditLogger.createAuditEntry for a read: DCM "Query" type,
 * a single Patient person-proxy requestor agent, one accessed entity, and
 * owner+access=bwell security tags.
 * @returns {Object} FHIR AuditEvent resource
 */
function buildRandomAuditEvent() {
    const id = generateUUID();
    const recorded = new Date(Date.now() - randInt(0, RECORDED_WINDOW_MS)).toISOString();
    const agentSourceId = `${PERSON_PROXY_PREFIX}${generateUUID()}`;

    return {
        resourceType: 'AuditEvent',
        id,
        meta: {
            versionId: '1',
            lastUpdated: recorded,
            security: [
                { system: SECURITY_TAG_SYSTEMS.OWNER, code: 'bwell' },
                { system: SECURITY_TAG_SYSTEMS.ACCESS, code: 'bwell' }
            ]
        },
        recorded,
        type: READ_EVENT_TYPE,
        action: READ_ACTION,
        // A single Patient person-proxy requestor agent (who = Patient/person.<user>).
        agent: [
            {
                who: { reference: `${pick(AGENT_RESOURCE_TYPES)}/${agentSourceId}` },
                requestor: true,
                network: { address: `10.0.0.${randInt(1, 254)}`, type: '2' }
            }
        ],
        source: {
            observer: { reference: getObserverOrganizationReference() }
        },
        // A single accessed entity carrying the request detail auditLogger attaches.
        entity: [
            {
                what: { reference: `${pick(ENTITY_RESOURCE_TYPES)}/${generateUUID()}` },
                detail: [
                    { type: 'requestUrl', valueString: `https://fhir.icanbwell.com/4_0_0/Patient/${id}` },
                    { type: 'requestId', valueString: generateUUID() }
                ]
            }
        ],
        purposeOfEvent: [
            {
                coding: [{ system: PURPOSE_OF_USE_SYSTEM, code: pick(PURPOSE_CODES) }]
            }
        ]
    };
}

/**
 * Adds the bwell-internal fields the write path stamps in preSave: a top-level
 * `_uuid` / `_sourceId` / `_sourceAssigningAuthority`, and on each who/what
 * reference a resolved `_uuid` (the hot ClickHouse column) and `_sourceId` (the
 * resource JSON path). Returns a new object; the input clean resource is left
 * untouched so it stays valid FHIR.
 * @param {Object} resource clean FHIR AuditEvent from buildRandomAuditEvent
 * @returns {Object} enriched document ready for AuditEventTransformer
 */
function enrichAuditEvent(resource) {
    const enrichReference = (ref) => {
        const [resourceType] = ref.reference.split('/');
        return {
            ...ref,
            _uuid: `${resourceType}/${generateUUID()}`,
            _sourceId: ref.reference,
            _sourceAssigningAuthority: SOURCE_ASSIGNING_AUTHORITY
        };
    };

    return {
        ...resource,
        _uuid: resource.id,
        _sourceId: resource.id,
        _sourceAssigningAuthority: SOURCE_ASSIGNING_AUTHORITY,
        agent: resource.agent.map((a) => ({ ...a, who: enrichReference(a.who) })),
        entity: resource.entity.map((e) => ({ ...e, what: enrichReference(e.what) }))
    };
}

/**
 * Enriches a clean FHIR AuditEvent (as the write path would), transforms it into
 * the flattened ClickHouse row via the real AuditEventTransformer, and wraps it
 * as a kafkajs message keyed by `_uuid`. One event per message.
 * @param {Object} auditEvent clean FHIR AuditEvent resource
 * @returns {{key: string, value: string}}
 */
function buildAuditEventMessage(auditEvent) {
    const row = transformer.transformDocument(enrichAuditEvent(auditEvent));
    return { key: row._uuid, value: JSON.stringify(row) };
}

/**
 * Generates `count` random AuditEvents and produces them to `topicName` in
 * batches of `batchSize`. `dryRun` prints the transformed JSON to stdout and
 * produces nothing.
 * @param {Object} params
 * @param {ConfigManager} params.configManager
 * @param {string} params.topicName fully-qualified (prefixed) topic name
 * @param {number} params.count
 * @param {number} params.batchSize
 * @param {import('kafkajs').CompressionTypes} [params.compression] codec applied
 *   to each produced batch; omit/undefined for no compression.
 * @param {boolean} params.dryRun
 * @returns {Promise<void>}
 */
async function sendRandomAuditEvents({
    configManager,
    topicName,
    count,
    batchSize,
    compression,
    dryRun
}) {
    const messages = Array.from({ length: count }, () =>
        buildAuditEventMessage(buildRandomAuditEvent())
    );

    if (dryRun) {
        for (const message of messages) {
            log.info('Dry run message', { key: message.key, row: JSON.parse(message.value) });
        }
        log.info('Dry run: generated messages without producing to Kafka', {
            topicName,
            count: messages.length
        });
        return;
    }

    const kafkaClientV2 = new KafkaClientV2({ configManager });
    try {
        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);
            await kafkaClientV2.sendCloudEventMessageAsync({
                topic: topicName,
                messages: batch,
                compression
            });
            log.info('Produced batch', {
                topicName,
                batchSize: batch.length,
                sent: Math.min(i + batch.length, messages.length),
                total: messages.length,
                // The message key is the generated AuditEvent _uuid.
                uuids: batch.map((message) => message.key)
            });
        }
        log.info('Finished producing AuditEvents', {
            topicName,
            count: messages.length,
            uuids: messages.map((message) => message.key)
        });
    } finally {
        await kafkaClientV2.disconnect();
    }
}

/**
 * @param {string[]} [argv] CLI args (defaults to the process args); passed
 * explicitly by tests so main() can be driven end-to-end without mutating
 * process.argv.
 */
async function main(argv = process.argv.slice(2)) {
    const { values } = parseArgs({
        args: argv,
        options: {
            count: { type: 'string' },
            'batch-size': { type: 'string' },
            compression: { type: 'string' },
            'dry-run': { type: 'boolean', default: false }
        }
    });

    const count = parseIntArg(values.count, DEFAULT_COUNT, 'count', 1);
    const batchSize = parseIntArg(values['batch-size'], DEFAULT_BATCH_SIZE, 'batch-size', 1);
    const compression = parseCompressionArg(values.compression);
    const dryRun = values['dry-run'];

    const configManager = new ConfigManager();
    log.info('Script started', {
        brokers: configManager.kafkaV2Brokers,
        authType: configManager.kafkaV2AuthType || 'none',
        topicName: TOPIC,
        count,
        batchSize,
        compression: values.compression || DEFAULT_COMPRESSION,
        dryRun
    });

    await sendRandomAuditEvents({
        configManager,
        topicName: TOPIC,
        count,
        batchSize,
        compression,
        dryRun
    });
}

// Only auto-run when invoked directly (node src/scripts/send_random_audit_events.js),
// not when imported by tests.
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            // Log message/stack explicitly: a bare Error serializes to {} in the
            // JSON logger because its fields are non-enumerable.
            log.error('send_random_audit_events script failed', {
                error: error.message,
                stack: error.stack
            });
            process.exit(1);
        });
}

module.exports = {
    buildRandomAuditEvent,
    buildAuditEventMessage,
    sendRandomAuditEvents,
    parseCompressionArg,
    main,
    TOPIC,
    DEFAULT_COUNT,
    DEFAULT_BATCH_SIZE,
    DEFAULT_COMPRESSION
};
