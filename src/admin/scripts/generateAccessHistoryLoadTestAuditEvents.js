#!/usr/bin/env node
/**
 * Seed synthetic AuditEvents into ClickHouse for $access-history load testing (DCON-4984).
 *
 * For each target Person, the script resolves its linked Patients and the refs of their
 * patient-linked resources by calling the code $access-history itself runs
 * (PersonToPatientIdsExpander.getPatientProxyIdsAsync, then AccessHistoryOperation._collectEntityRefs)
 * with a system-scoped request, so link depth, the Person.link assurance gate and lookup errors
 * behave as they do in the endpoint. It then writes
 * AuditEvents that read those resources to fhir.AuditEvent_4_0_0, so AUDIT_ACCESS_MV populates
 * AUDIT_ACCESS_AGG exactly as production writes would.
 *
 * Rows take the same path the server's own AuditEvents take (--sink auto): with ClickPipe enabled
 * (ENABLE_AUDIT_EVENT_CLICKPIPE and ENABLE_EVENTS_KAFKA_V2) they are published to the ClickPipe
 * Kafka topic in the live write path's message shape, chunk size and compression; otherwise they
 * are inserted into ClickHouse directly.
 *
 * Accessors cover every requestor type AuditLogger.buildAgents can write: users as
 * Patient/person.<uuid> (the person themselves plus other Persons), and delegated actors for each
 * of DELEGATED_ACCESS.ALLOWED_ACTOR_RESOURCE_TYPES (RelatedPerson, Organization).
 *
 * All generated events carry _sourceAssigningAuthority = SOURCE_TAG so they can be removed later.
 * Refuses to run when ENVIRONMENT looks like production. Accessors are only sampled from resources
 * whose id starts with --id-prefix (the seeded load-test data), and outside ENVIRONMENT=local every
 * target Person must match it too, so shared environments never get access history attributed to
 * or recorded against real records.
 *
 * Usage:
 *   node src/admin/scripts/generateAccessHistoryLoadTestAuditEvents.js [options]
 */

const fs = require('fs');
const { randomUUID } = require('crypto');
const { createContainer } = require('../../createContainer');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const { logInfo, logError, logWarn } = require('../../operations/common/logging');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { PERSON_PROXY_PREFIX, PURPOSE_OF_USE_SYSTEM, DELEGATED_ACCESS } = require('../../constants');
const { sliceIntoChunks } = require('../../utils/list.util');
const { parsePositiveInt, formatElapsed, insertWithRetryAsync } = require('./migrateAuditEventsToClickhouse');
const { publishWithRetryAsync } = require('./migrateAuditEventsToKafkaClickPipes');
const { KAFKA_TOPICS } = require('../../constants/clickHouseConstants');
const { getKafkaCompressionType } = require('../../utils/kafkaClientV2');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');

const SOURCE_TAG = 'access-history-loadtest';
const BASE_VERSION = '4_0_0';
const DAY_MS = 24 * 60 * 60 * 1000;
const PURPOSE_CODES = ['TREAT', 'PATRQT', 'HPAYMT', 'HOPERAT', 'CAREMGT'];
const USER_ACCESSOR_TYPE = 'user';
const ACCESSOR_TYPES = [USER_ACCESSOR_TYPE, ...DELEGATED_ACCESS.ALLOWED_ACTOR_RESOURCE_TYPES];
const SINKS = ['auto', 'clickpipe', 'direct'];

const USAGE = `
Usage: node src/admin/scripts/generateAccessHistoryLoadTestAuditEvents.js [options]

Connections come from the standard FHIR server environment (MONGO_*, CLICKHOUSE_*,
ENABLE_CLICKHOUSE=1). Pick target persons with exactly one of:
  --person-id <id[,id...]>      Person _uuid or id; comma-separate for several
  --person-id-prefix <prefix>   Every Person whose id starts with <prefix>, e.g. ahlt-person-
  --sample-persons <n>          Random Persons that have at least one linked Patient (ENVIRONMENT=local only)

Options:
  --events-per-person <n>       AuditEvents per person (default: 100000)
  --min-resources <n>           Fewest distinct resources each person's events read (default: 1000)
  --max-resources <n>           Most distinct resources each person's events read (default: 1500);
                                each person gets a random count in [min, max], every one read at least once
  --accessors <n>               Distinct accessors per person, split evenly across user, RelatedPerson
                                and Organization; the user share includes the person themselves
                                (default: 50, minimum: 3)
  --accessor-pool-size <n>      Accessors sampled from MongoDB per type, shared by all persons (default: 500)
  --id-prefix <prefix>          Only sample accessors whose id starts with <prefix>; outside ENVIRONMENT=local,
                                target Persons must match it as well (default: ahlt-)
  --days <n>                    Spread recorded over the last n days (default: 90, i.e. the past 3 months)
  --max-entities-per-event <n>  Upper bound on entity[] length for search events (default: 20)
  --replay-percent <n>          Percent of events re-inserted in a later batch, as replays (default: 1)
  --sink <auto|clickpipe|direct> Where rows go (default: auto). auto follows the server: ClickPipe
                                Kafka topic when ENABLE_AUDIT_EVENT_CLICKPIPE and ENABLE_EVENTS_KAFKA_V2
                                are set, else direct ClickHouse insert
  --kafka-concurrency <n>       Kafka publishes in flight for the clickpipe sink (default: 10)
  --batch-size <n>              Rows generated per batch (default: 10000)
  --output-persons <path>       Write [{id, uuid, patients, entityRefs, resourcesAccessed}] JSON for the k6 script
  --dry-run                     Resolve persons and report counts without inserting
  --help, -h                    Show this help

With the clickpipe sink, rows land asynchronously once ClickPipes consumes them; check
  SELECT count() FROM fhir.AuditEvent_4_0_0 WHERE _sourceAssigningAuthority = '${SOURCE_TAG}'
before load testing.

Cleanup (non-prod only):
  ALTER TABLE fhir.AuditEvent_4_0_0 DELETE WHERE _sourceAssigningAuthority = '${SOURCE_TAG}';
  AUDIT_ACCESS_AGG has no source column; delete its rows by the seeded entity_refs.
`;

function parsePercent(flag, raw) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
        logError(`${flag} requires a number between 0 and 100`);
        process.exit(1);
    }
    return value;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        personIds: null,
        personIdPrefix: null,
        samplePersons: null,
        idPrefix: 'ahlt-',
        eventsPerPerson: 100000,
        minResources: 1000,
        maxResources: 1500,
        accessors: 50,
        accessorPoolSize: 500,
        days: 90,
        maxEntitiesPerEvent: 20,
        replayPercent: 1,
        batchSize: 10000,
        sink: 'auto',
        kafkaConcurrency: 10,
        outputPersons: null,
        dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        switch (flag) {
            case '--person-id':
                options.personIds = (args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
                break;
            case '--person-id-prefix':
                options.personIdPrefix = args[++i];
                break;
            case '--id-prefix':
                options.idPrefix = args[++i] || '';
                break;
            case '--sample-persons':
                options.samplePersons = parsePositiveInt(flag, args[++i]);
                break;
            case '--events-per-person':
                options.eventsPerPerson = parsePositiveInt(flag, args[++i]);
                break;
            case '--min-resources':
                options.minResources = parsePositiveInt(flag, args[++i]);
                break;
            case '--max-resources':
                options.maxResources = parsePositiveInt(flag, args[++i]);
                break;
            case '--accessors':
                options.accessors = parsePositiveInt(flag, args[++i]);
                break;
            case '--accessor-pool-size':
                options.accessorPoolSize = parsePositiveInt(flag, args[++i]);
                break;
            case '--days':
                options.days = parsePositiveInt(flag, args[++i]);
                break;
            case '--max-entities-per-event':
                options.maxEntitiesPerEvent = parsePositiveInt(flag, args[++i]);
                break;
            case '--replay-percent':
                options.replayPercent = parsePercent(flag, args[++i]);
                break;
            case '--batch-size':
                options.batchSize = parsePositiveInt(flag, args[++i]);
                break;
            case '--sink':
                options.sink = args[++i];
                if (!SINKS.includes(options.sink)) {
                    logError(`--sink must be one of ${SINKS.join(', ')}`);
                    process.exit(1);
                }
                break;
            case '--kafka-concurrency':
                options.kafkaConcurrency = parsePositiveInt(flag, args[++i]);
                break;
            case '--output-persons':
                options.outputPersons = args[++i];
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--help':
            case '-h':
                logInfo(USAGE);
                process.exit(0);
                break;
            default:
                logError(`Unknown option: ${flag}`);
                process.exit(1);
        }
    }

    const selectors = [options.personIds, options.personIdPrefix, options.samplePersons].filter((v) => v);
    if (selectors.length !== 1) {
        logError('Specify exactly one of --person-id, --person-id-prefix, --sample-persons');
        process.exit(1);
    }
    if (options.minResources > options.maxResources) {
        logError('--min-resources must not exceed --max-resources');
        process.exit(1);
    }
    if (options.accessors < ACCESSOR_TYPES.length) {
        logError(`--accessors must be at least ${ACCESSOR_TYPES.length} so every accessor type is included`);
        process.exit(1);
    }
    return options;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idPrefixMatch = (prefix) => (prefix ? { id: { $regex: `^${escapeRegex(prefix)}` } } : {});

const randomInt = (maxExclusive) => Math.floor(Math.random() * maxExclusive);
const pick = (arr) => arr[randomInt(arr.length)];

/**
 * A service-account caller with no patient scope and wildcard access tags, so the endpoint's own
 * lookups apply no person or access-tag narrowing, matching a system token call to $access-history.
 */
function buildSystemRequestInfo() {
    return new FhirRequestInfo({
        user: SOURCE_TAG,
        scope: 'user/*.* access/*.*',
        isUser: false,
        requestId: SOURCE_TAG,
        userRequestId: SOURCE_TAG,
        headers: {},
        method: 'GET',
        contentTypeFromHeader: null
    });
}

/**
 * Resolves the refs $access-history queries ClickHouse with, through the same calls it makes.
 * Lookup errors propagate, as they do in the endpoint.
 * @returns {Promise<{patients: number, entityRefs: string[]}|null>} null when the Person has no linked Patients
 */
async function collectEntityRefsAsync({ personToPatientIdsExpander, accessHistoryOperation, requestInfo, personUuid }) {
    const patientUuids = await personToPatientIdsExpander.getPatientProxyIdsAsync({
        base_version: BASE_VERSION,
        ids: [personUuid],
        includePatientPrefix: false,
        requestInfo
    });
    // The result can hold just the person.<id> proxy entry (e.g. every link fails the assurance
    // gate) or echo the input ids back; either way there is nothing for the endpoint to find.
    const linkedPatients = patientUuids.filter((uuid) => !uuid.startsWith(PERSON_PROXY_PREFIX) && uuid !== personUuid);
    if (linkedPatients.length === 0) {
        return null;
    }
    const entityRefs = await accessHistoryOperation._collectEntityRefs({
        requestInfo,
        patientUuids,
        base_version: BASE_VERSION
    });
    return { patients: linkedPatients.length, entityRefs };
}

async function sampleUuidsAsync(db, collectionName, size, match = {}) {
    if (size <= 0) {
        return [];
    }
    const docs = await db.collection(collectionName)
        .aggregate([{ $match: match }, { $sample: { size } }, { $project: { _uuid: 1 } }])
        .toArray();
    return docs.map((d) => d._uuid).filter(Boolean);
}

const userAccessor = (personUuid) => ({ ref: `Patient/${PERSON_PROXY_PREFIX}${personUuid}`, delegated: false });

/**
 * Per accessor type, real resources are sampled so $access-history's display-name and
 * organization lookups do real work; synthetic ids top up a type if MongoDB is sparse.
 * @returns {Promise<Object<string, {ref: string, delegated: boolean}[]>>} accessors keyed by type
 */
async function buildAccessorPoolAsync(db, sizePerType, idPrefix) {
    const pool = {};
    for (const type of ACCESSOR_TYPES) {
        const collectionName = type === USER_ACCESSOR_TYPE ? 'Person_4_0_0' : `${type}_4_0_0`;
        const uuids = await sampleUuidsAsync(db, collectionName, sizePerType, idPrefixMatch(idPrefix));
        if (uuids.length < sizePerType) {
            logWarn('Accessor pool topped up with synthetic accessors that will not resolve to a display name', {
                type,
                sampled: uuids.length,
                synthetic: sizePerType - uuids.length
            });
            while (uuids.length < sizePerType) {
                uuids.push(randomUUID());
            }
        }
        pool[`${type}`] = uuids.map((uuid) =>
            (type === USER_ACCESSOR_TYPE ? userAccessor(uuid) : { ref: `${type}/${uuid}`, delegated: true }));
    }
    return pool;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Picks `count` distinct accessors split evenly across types, the person themselves counting
 * toward the user share. Weights fall off as 1/rank over a shuffled order, so a few accessors
 * dominate, as in real traffic, without favouring any one type.
 */
function buildPersonAccessors(personUuid, pool, count) {
    const self = userAccessor(personUuid);
    const accessors = [];
    ACCESSOR_TYPES.forEach((type, index) => {
        const share = Math.floor(count / ACCESSOR_TYPES.length) + (index < count % ACCESSOR_TYPES.length ? 1 : 0);
        const candidates = shuffle(pool[`${type}`].filter((a) => a.ref !== self.ref));
        const chosen = type === USER_ACCESSOR_TYPE ? [self, ...candidates.slice(0, share - 1)] : candidates.slice(0, share);
        if (chosen.length < share) {
            logWarn('Accessor pool smaller than requested share; raise --accessor-pool-size', { type, share, available: chosen.length });
        }
        accessors.push(...chosen);
    });
    shuffle(accessors);
    const cumulative = [];
    let total = 0;
    accessors.forEach((_, rank) => {
        total += 1 / (rank + 1);
        cumulative.push(total);
    });
    const next = () => {
        const r = Math.random() * total;
        return accessors[cumulative.findIndex((c) => c >= r)];
    };
    next.accessorCounts = accessors.reduce((counts, a) => {
        const type = a.delegated ? a.ref.split('/')[0] : USER_ACCESSOR_TYPE;
        counts[`${type}`] = (counts[`${type}`] || 0) + 1;
        return counts;
    }, {});
    return next;
}

/**
 * Picks a random subset of the person's resources to be "accessed". Patient refs are always
 * included, since a person's own Patient is read on almost every visit. The returned picker walks
 * the shuffled subset once before choosing at random, so every chosen resource is read at least
 * once as long as the run makes at least that many entity picks.
 */
function buildPersonResourcePicker(entityRefs, minResources, maxResources) {
    const target = minResources + randomInt(maxResources - minResources + 1);
    const readable = entityRefs.filter((ref) => !ref.startsWith(`Patient/${PERSON_PROXY_PREFIX}`));
    const patientRefs = readable.filter((ref) => ref.startsWith('Patient/'));
    const others = shuffle(readable.filter((ref) => !ref.startsWith('Patient/')));
    const subset = shuffle([...patientRefs, ...others].slice(0, target));
    let cursor = 0;
    const next = () => (cursor < subset.length ? subset[cursor++] : pick(subset));
    next.target = target;
    next.size = subset.length;
    return next;
}

/**
 * Builds an AuditEvent shaped like AuditLogger.createAuditEntry output.
 */
function buildAuditEvent({ personUuid, accessor, nextEntityRef, days, maxEntitiesPerEvent }) {
    const recorded = new Date(Date.now() - randomInt(days * DAY_MS)).toISOString();
    const isSearch = Math.random() < 0.3;
    const entityCount = isSearch ? Math.min(maxEntitiesPerEvent, 2 + randomInt(Math.max(1, maxEntitiesPerEvent - 1))) : 1;
    const entities = [];
    for (let i = 0; i < entityCount; i++) {
        entities.push({ what: { reference: nextEntityRef() } });
    }
    // Shapes from AuditLogger.buildAgents. Delegated: the person on whose behalf the actor
    // acts is the non-requestor agent and the actor is the requestor. User: a single requestor.
    const requestor = { who: { reference: accessor.ref }, requestor: true, network: { type: '2' } };
    const agent = accessor.delegated
        ? [{ who: { reference: userAccessor(personUuid).ref }, requestor: false, network: { type: '2' } }, requestor]
        : [requestor];
    const id = randomUUID();

    return {
        resourceType: 'AuditEvent',
        id,
        _uuid: id,
        _sourceId: id,
        _sourceAssigningAuthority: SOURCE_TAG,
        meta: {
            versionId: '1',
            lastUpdated: recorded,
            source: SOURCE_TAG,
            security: [
                { system: SecurityTagSystem.owner, code: 'bwell' },
                { system: SecurityTagSystem.access, code: 'bwell' }
            ]
        },
        recorded,
        type: { system: 'http://dicom.nema.org/resources/ontology/DCM', code: '110112', display: 'Query' },
        action: 'R',
        agent,
        entity: entities,
        purposeOfEvent: Math.random() < 0.3
            ? [{ coding: [{ system: PURPOSE_OF_USE_SYSTEM, code: pick(PURPOSE_CODES) }] }]
            : undefined
    };
}

class DirectClickHouseSink {
    constructor({ clickHouseClientManager }) {
        this.name = 'direct';
        this.clickHouseClientManager = clickHouseClientManager;
    }

    async openAsync() {
        await this.clickHouseClientManager.getClientAsync();
    }

    async writeAsync(rows) {
        await insertWithRetryAsync(this.clickHouseClientManager, rows);
    }

    async closeAsync() {
        await this.clickHouseClientManager.closeAsync();
    }
}

/**
 * Publishes rows as KafkaClickPipeBulkWriteExecutor does: one message per row, key _uuid,
 * value the flat row JSON that ClickPipes maps onto AuditEvent_4_0_0 columns.
 */
class ClickPipeKafkaSink {
    constructor({ kafkaClientV2, configManager, concurrency }) {
        this.name = 'clickpipe';
        this.kafkaClientV2 = kafkaClientV2;
        this.topic = KAFKA_TOPICS.AUDIT_EVENT;
        this.chunkSize = configManager.auditEventClickPipeBatchSize;
        this.compressionName = configManager.auditEventClickPipeCompression;
        this.compression = getKafkaCompressionType(this.compressionName);
        this.concurrency = concurrency;
    }

    async openAsync() {}

    async writeAsync(rows) {
        const messages = rows.map((row) => ({
            key: row._uuid,
            value: JSON.stringify(row),
            headers: { version: 'R4', requestId: SOURCE_TAG }
        }));
        const chunks = sliceIntoChunks(messages, this.chunkSize);
        for (const group of sliceIntoChunks(chunks, this.concurrency)) {
            await Promise.all(group.map((chunk) =>
                publishWithRetryAsync(this.kafkaClientV2, this.topic, chunk, this.compression)));
        }
    }

    async closeAsync() {
        await this.kafkaClientV2.disconnect();
    }
}

/**
 * Mirrors createContainer's activation gate for KafkaClickPipeBulkWriteExecutor. Kafka V2 must
 * be enabled for clickpipe: otherwise kafkaClientV2 is a dummy client that drops every message.
 */
function createSink(container, options) {
    const { configManager } = container;
    const clickPipeAvailable = configManager.enableAuditEventClickPipe && configManager.kafkaV2EnableEvents;
    const sink = options.sink === 'auto' ? (clickPipeAvailable ? 'clickpipe' : 'direct') : options.sink;
    if (sink === 'clickpipe') {
        if (!configManager.kafkaV2EnableEvents) {
            throw new Error('--sink clickpipe needs ENABLE_EVENTS_KAFKA_V2=1 and KAFKA_V2_* settings; ' +
                'without them every message would be silently dropped');
        }
        return new ClickPipeKafkaSink({
            kafkaClientV2: container.kafkaClientV2,
            configManager,
            concurrency: options.kafkaConcurrency
        });
    }
    return new DirectClickHouseSink({ clickHouseClientManager: container.clickHouseClientManager });
}

/**
 * @returns {Promise<{_uuid: string, id: string}[]>}
 */
async function resolvePersonsAsync(db, options) {
    const persons = db.collection('Person_4_0_0');
    const projection = { _uuid: 1, id: 1 };
    if (options.samplePersons) {
        return persons
            .aggregate([
                { $match: { 'link.target._uuid': /^Patient\// } },
                { $sample: { size: options.samplePersons } },
                { $project: projection }
            ])
            .toArray();
    }
    if (options.personIdPrefix) {
        return persons.find(idPrefixMatch(options.personIdPrefix), { projection }).sort({ id: 1 }).toArray();
    }
    const docs = await persons
        .find({ $or: [{ _uuid: { $in: options.personIds } }, { id: { $in: options.personIds } }] }, { projection })
        .toArray();
    const found = new Set(docs.flatMap((d) => [d._uuid, d.id]));
    const notFound = options.personIds.filter((id) => !found.has(id));
    if (notFound.length > 0) {
        logWarn('Persons not found, skipping', { count: notFound.length, notFound: notFound.slice(0, 20) });
    }
    return docs;
}

/**
 * Shared environments only get load-test data on load-test Persons.
 * @returns {string|null} why the run is refused, or null when it may proceed
 */
function checkSharedEnvironmentTargets({ environment, options, persons }) {
    if (environment === 'local') {
        return null;
    }
    if (options.samplePersons) {
        return '--sample-persons is only allowed with ENVIRONMENT=local; use --person-id-prefix or --person-id';
    }
    if (!options.idPrefix) {
        return '--id-prefix must be non-empty outside ENVIRONMENT=local';
    }
    const outside = persons.filter((p) => !(p.id || '').startsWith(options.idPrefix));
    if (outside.length > 0) {
        return `${outside.length} target Person(s) do not start with --id-prefix ${options.idPrefix}: ` +
            outside.slice(0, 10).map((p) => p.id || p._uuid).join(', ');
    }
    return null;
}

async function seedPersonAsync({ lookup, sink, transformer, accessorPool, personUuid, options }) {
    const resolved = await collectEntityRefsAsync({ ...lookup, personUuid });
    if (!resolved) {
        logWarn('Person has no linked Patients that $access-history would follow, skipping', { personUuid });
        return null;
    }
    const { patients, entityRefs } = resolved;
    const nextEntityRef = buildPersonResourcePicker(entityRefs, options.minResources, options.maxResources);
    const summary = {
        uuid: personUuid,
        patients,
        entityRefs: entityRefs.length,
        resourcesAccessed: nextEntityRef.size,
        inserted: 0,
        replayed: 0
    };
    if (nextEntityRef.size < nextEntityRef.target) {
        logWarn('Person has fewer resources than the requested access count; all of them will be accessed', {
            personUuid,
            requested: nextEntityRef.target,
            available: nextEntityRef.size
        });
    }
    if (options.dryRun) {
        return summary;
    }

    const nextAccessor = buildPersonAccessors(personUuid, accessorPool, options.accessors);
    summary.accessors = nextAccessor.accessorCounts;
    let pendingReplays = [];
    let generated = 0;
    while (generated < options.eventsPerPerson) {
        const size = Math.min(options.batchSize, options.eventsPerPerson - generated);
        const rows = [];
        const replaysForLater = [];
        for (let i = 0; i < size; i++) {
            const row = transformer.transformDocument(buildAuditEvent({
                personUuid,
                accessor: nextAccessor(),
                nextEntityRef,
                days: options.days,
                maxEntitiesPerEvent: options.maxEntitiesPerEvent
            }));
            rows.push(row);
            if (Math.random() * 100 < options.replayPercent) {
                replaysForLater.push(row);
            }
        }
        // Replays from the previous batch land in a separate write, as a Kafka
        // rebalance or insert retry would, which is the case uniqExact must dedupe.
        await sink.writeAsync(rows.concat(pendingReplays));
        summary.replayed += pendingReplays.length;
        pendingReplays = replaysForLater;
        generated += size;
        summary.inserted += size;
    }
    if (pendingReplays.length > 0) {
        await sink.writeAsync(pendingReplays);
        summary.replayed += pendingReplays.length;
    }
    return summary;
}

async function main() {
    const options = parseArgs();
    const container = createContainer();
    const environment = container.configManager.environmentValue;
    if (/prod/i.test(environment)) {
        logError('Refusing to seed load-test AuditEvents in a production environment', { environment });
        return 1;
    }

    const mongoDatabaseManager = container.mongoDatabaseManager;
    const sink = createSink(container, options);
    const transformer = new AuditEventTransformer();
    const startTime = Date.now();

    let aborted = false;
    const onSignal = () => {
        aborted = true;
        logWarn('Received signal; finishing current person then exiting');
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
        const db = await mongoDatabaseManager.getClientDbAsync();
        if (!options.dryRun) {
            await sink.openAsync();
        }

        const persons = await resolvePersonsAsync(db, options);
        const refusal = checkSharedEnvironmentTargets({ environment, options, persons });
        if (refusal) {
            logError('Refusing to seed', { environment, reason: refusal });
            return 1;
        }
        const personUuids = [...new Set(persons.map((p) => p._uuid))];
        const accessorPool = await buildAccessorPoolAsync(db, options.accessorPoolSize, options.idPrefix);
        const lookup = {
            personToPatientIdsExpander: container.personToPatientIdsExpander,
            accessHistoryOperation: container.accessHistoryOperation,
            requestInfo: buildSystemRequestInfo()
        };
        logInfo('Seeding access-history load-test AuditEvents', {
            environment,
            persons: personUuids.length,
            eventsPerPerson: options.eventsPerPerson,
            accessorsPerPerson: options.accessors,
            accessorPoolPerType: options.accessorPoolSize,
            idPrefix: options.idPrefix,
            days: options.days,
            sink: sink.name,
            ...(sink.name === 'clickpipe' && {
                topic: sink.topic,
                chunkSize: sink.chunkSize,
                compression: sink.compressionName
            }),
            dryRun: options.dryRun
        });

        const summaries = [];
        for (const [index, personUuid] of personUuids.entries()) {
            if (aborted) {
                break;
            }
            const summary = await seedPersonAsync({
                lookup,
                sink,
                transformer,
                accessorPool,
                personUuid,
                options
            });
            if (summary) {
                summaries.push(summary);
                logInfo('Person seeded', {
                    progress: `${index + 1}/${personUuids.length}`,
                    ...summary,
                    elapsed: formatElapsed(Date.now() - startTime)
                });
            }
        }

        if (options.outputPersons) {
            fs.writeFileSync(options.outputPersons, JSON.stringify(
                summaries.map(({ uuid, patients, entityRefs, resourcesAccessed }) => ({ id: uuid, uuid, patients, entityRefs, resourcesAccessed })), null, 2
            ));
        }
        logInfo('Seeding complete', {
            persons: summaries.length,
            totalInserted: summaries.reduce((n, s) => n + s.inserted, 0),
            totalReplayed: summaries.reduce((n, s) => n + s.replayed, 0),
            elapsed: formatElapsed(Date.now() - startTime),
            sink: sink.name,
            aborted
        });
        if (sink.name === 'clickpipe') {
            logInfo('Rows were published to Kafka; they appear in ClickHouse once ClickPipes consumes them', {
                topic: sink.topic
            });
        }
        return aborted ? 1 : 0;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        await mongoDatabaseManager.disconnectAsync();
        await sink.closeAsync();
    }
}

if (require.main === module) {
    main()
        .then((code) => process.exit(code))
        .catch((error) => {
            logError('Fatal error', { error: error.message, stack: error.stack });
            process.exit(1);
        });
}

module.exports = { checkSharedEnvironmentTargets, createSink, ClickPipeKafkaSink, DirectClickHouseSink, buildAuditEvent, buildPersonAccessors, buildPersonResourcePicker, collectEntityRefsAsync };
