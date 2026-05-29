const crypto = require('crypto');
const { BaseScriptRunner } = require('./baseScriptRunner');
const { assertTypeEquals } = require('../../utils/assertType');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { AuditEventFieldExtractor } = require('../../dataLayer/clickHouse/auditEventFieldExtractor');
const { logInfo, logError } = require('../../operations/common/logging');
const AuditEvent = require('../../fhir/classes/4_0_0/resources/auditEvent');
const Meta = require('../../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const Reference = require('../../fhir/classes/4_0_0/complex_types/reference');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const AuditEventAgent = require('../../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const AuditEventSource = require('../../fhir/classes/4_0_0/backbone_elements/auditEventSource');
const AuditEventEntity = require('../../fhir/classes/4_0_0/backbone_elements/auditEventEntity');
const AuditEventNetwork = require('../../fhir/classes/4_0_0/backbone_elements/auditEventNetwork');

const PURPOSE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ActReason';

class GenerateAuditAccessLoadDataRunner extends BaseScriptRunner {
    /**
     * @param {{
     *   adminLogger: import('../adminLogger').AdminLogger,
     *   mongoDatabaseManager: import('../../utils/mongoDatabaseManager').MongoDatabaseManager,
     *   clickHouseClientManager: ClickHouseClientManager,
     *   accessor: string,
     *   patientId: string,
     *   resourceTypes: string[],
     *   count: number,
     *   months: string[],
     *   batchSize: number,
     *   purpose: string[],
     *   dryRun: boolean
     * }} params
     */
    constructor({
        adminLogger,
        mongoDatabaseManager,
        clickHouseClientManager,
        patientFilterManager,
        databaseQueryFactory,
        preSaveManager,
        accessor,
        patientId,
        resourceTypes,
        count,
        months,
        batchSize,
        purpose,
        dryRun
    }) {
        super({ adminLogger, mongoDatabaseManager });

        if (clickHouseClientManager) {
            assertTypeEquals(clickHouseClientManager, ClickHouseClientManager);
        }

        this.clickHouseClientManager = clickHouseClientManager;
        this.patientFilterManager = patientFilterManager;
        this.databaseQueryFactory = databaseQueryFactory;
        this.preSaveManager = preSaveManager;
        this.fieldExtractor = new AuditEventFieldExtractor();
        this.accessor = accessor;
        this.patientId = patientId;
        this.resourceTypes = resourceTypes;
        this.count = count;
        this.months = months;
        this.batchSize = batchSize;
        this.purpose = purpose;
        this.dryRun = dryRun;
    }

    async processAsync() {
        const PREFIX = 'GenerateAuditAccessLoadData';

        if (!this.clickHouseClientManager && !this.dryRun) {
            logError(`${PREFIX}: ClickHouseClientManager unavailable. Set ENABLE_CLICKHOUSE=1.`);
            throw new Error('ClickHouseClientManager unavailable');
        }

        const startTime = Date.now();

        try {
            await this.init();

            logInfo(`${PREFIX}: starting`, {
                accessor: this.accessor,
                patientId: this.patientId,
                resourceTypes: this.resourceTypes,
                count: this.count,
                months: this.months,
                dryRun: this.dryRun
            });

            const { entityPool, resourceBreakdown } = await this._fetchEntityPoolAsync();

            if (entityPool.length === 0) {
                logError(`${PREFIX}: No resources found for patient ${this.patientId}`);
                return 1;
            }

            const totalEvents = entityPool.length * this.count;
            logInfo(`${PREFIX}: found resources`, {
                totalResources: entityPool.length,
                breakdown: resourceBreakdown,
                totalEvents,
                months: this.months
            });

            if (this.dryRun) {
                const sampleEvents = await this._generateEventsForResource(entityPool[0]);
                logInfo(`${PREFIX}: [DRY RUN] sample events for ${entityPool[0]}`, {
                    sampleCount: Math.min(3, sampleEvents.length),
                    samples: sampleEvents.slice(0, 3)
                });
                logInfo(`${PREFIX}: [DRY RUN] would insert ${totalEvents} events`);
                return 0;
            }

            await this.clickHouseClientManager.getClientAsync();
            logInfo(`${PREFIX}: connected to ClickHouse`);

            let insertedCount = 0;
            let batch = [];
            const totalBatches = Math.ceil(totalEvents / this.batchSize);
            let batchNo = 0;

            for (const entityRef of entityPool) {
                const events = await this._generateEventsForResource(entityRef);
                batch.push(...events);

                while (batch.length >= this.batchSize) {
                    batchNo++;
                    const batchStart = Date.now();
                    const toInsert = batch.splice(0, this.batchSize);

                    await this.clickHouseClientManager.insertAsync({
                        table: 'fhir.AuditEvent_4_0_0',
                        values: toInsert
                    });

                    insertedCount += toInsert.length;
                    logInfo(`${PREFIX}: batch complete`, {
                        batchNo,
                        totalBatches,
                        rowsInserted: toInsert.length,
                        totalInserted: insertedCount,
                        batchMs: Date.now() - batchStart
                    });
                }
            }

            if (batch.length > 0) {
                batchNo++;
                const batchStart = Date.now();
                await this.clickHouseClientManager.insertAsync({
                    table: 'fhir.AuditEvent_4_0_0',
                    values: batch
                });
                insertedCount += batch.length;
                logInfo(`${PREFIX}: batch complete`, {
                    batchNo,
                    totalBatches,
                    rowsInserted: batch.length,
                    totalInserted: insertedCount,
                    batchMs: Date.now() - batchStart
                });
            }

            const elapsedMs = Date.now() - startTime;
            logInfo(`${PREFIX}: done`, {
                totalInserted: insertedCount,
                totalResources: entityPool.length,
                countPerResource: this.count,
                months: this.months,
                elapsedMs,
                eventsPerSec: Math.round(insertedCount / (elapsedMs / 1000))
            });

            return 0;
        } catch (error) {
            logError(`${PREFIX}: failed`, {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async _fetchEntityPoolAsync() {
        const PREFIX = 'GenerateAuditAccessLoadData';
        const patientRef = `Patient/${this.patientId}`;
        const entityPool = [];
        const resourceBreakdown = {};

        for (const resourceType of this.resourceTypes) {
            const property = this.patientFilterManager.getPatientPropertyForResource({ resourceType });

            if (!property) {
                logError(`${PREFIX}: no patient filter mapping for ${resourceType}, skipping`);
                continue;
            }

            const field = property === 'id' ? '_uuid' : property.replace('.reference', '._uuid');
            const queryValue = property === 'id' ? this.patientId : patientRef;
            logInfo(`${PREFIX}: querying ${resourceType}`, { field, queryValue });

            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType,
                base_version: '4_0_0'
            });

            const cursor = await databaseQueryManager.findAsync({
                query: { [field]: queryValue },
                options: { projection: { _uuid: 1 } }
            });

            let count = 0;
            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                if (doc._uuid) {
                    const ref = doc._uuid.includes('/') ? doc._uuid : `${resourceType}/${doc._uuid}`;
                    entityPool.push(ref);
                    count++;
                }
            }
            resourceBreakdown[resourceType] = count;
        }

        return { entityPool, resourceBreakdown };
    }

    async _generateEventsForResource(entityRef) {
        if (this.months.length === 0) {
            return [];
        }
        const eventsPerMonth = Math.floor(this.count / this.months.length);
        const remainder = this.count % this.months.length;
        const events = [];

        for (let monthIdx = 0; monthIdx < this.months.length; monthIdx++) {
            const monthStr = this.months[monthIdx];
            const eventsThisMonth = eventsPerMonth + (monthIdx < remainder ? 1 : 0);

            for (let i = 0; i < eventsThisMonth; i++) {
                events.push(await this._buildRow(entityRef, monthStr));
            }
        }

        return events;
    }

    async _buildRow(entityRef, monthStr) {
        const id = crypto.randomUUID();
        const recordedDate = new Date(this._randomTimestampInMonth(monthStr) + 'Z');

        const purposeOfEvent = this.purpose.length > 0
            ? this.purpose.map((code) => new CodeableConcept({
                coding: [new Coding({ system: PURPOSE_SYSTEM, code })]
            }))
            : undefined;

        const auditEvent = new AuditEvent({
            id,
            meta: new Meta({
                versionId: '1',
                lastUpdated: recordedDate,
                security: [
                    new Coding({ system: 'https://www.icanbwell.com/owner', code: 'bwell' }),
                    new Coding({ system: 'https://www.icanbwell.com/access', code: 'bwell' })
                ]
            }),
            type: new Coding({
                system: 'http://dicom.nema.org/resources/ontology/DCM',
                code: '110112',
                display: 'Query'
            }),
            action: 'R',
            recorded: recordedDate,
            purposeOfEvent,
            agent: [
                new AuditEventAgent({
                    who: new Reference({
                        reference: this.accessor
                    }),
                    altId: '',
                    requestor: true,
                    network: new AuditEventNetwork({ type: '2' })
                })
            ],
            source: new AuditEventSource({
                observer: new Reference({ reference: 'Organization/bwell' })
            }),
            entity: [
                new AuditEventEntity({
                    what: new Reference({
                        reference: entityRef
                    })
                })
            ]
        });

        await this.preSaveManager.preSaveAsync({ resource: auditEvent });
        return this.fieldExtractor.extract(auditEvent);
    }

    _randomTimestampInMonth(monthStr) {
        const [year, month] = monthStr.split('-').map(Number);
        const day = Math.floor(Math.random() * 28) + 1;
        const hour = Math.floor(Math.random() * 24);
        const minute = Math.floor(Math.random() * 60);
        const second = Math.floor(Math.random() * 60);
        const ms = Math.floor(Math.random() * 1000);

        const dd = String(day).padStart(2, '0');
        const hh = String(hour).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');
        const ss = String(second).padStart(2, '0');
        const mmm = String(ms).padStart(3, '0');
        const mo = String(month).padStart(2, '0');

        return `${year}-${mo}-${dd} ${hh}:${mm}:${ss}.${mmm}`;
    }
}

module.exports = {
    GenerateAuditAccessLoadDataRunner
};
