const { describe, test, expect, jest } = require('@jest/globals');
const { AuditEventTransformer } = require('../../dataLayer/clickHouse/auditEventTransformer');
const {
    generateHourlyPartitions,
    hourKeyFromDate,
    hourKeyToDate,
    toClickHouseDateTime64
} = require('../../admin/utils/migrationStateManager');
const { PartitionWorker } = require('../../admin/utils/partitionWorker');
const {
    defaultDateRange,
    normalizeCliDateToHour,
    hourBoundsFromCli,
    parseMonthArg
} = require('../../admin/scripts/migrateAuditEventsToClickhouse');
const deepcopy = require('deepcopy');
const auditEventSample = require('./fixtures/audit_event_sample.json');

describe('AuditEvent Migration', () => {
    describe('AuditEventTransformer', () => {
        describe('transformDocument', () => {
            test('transforms a full AuditEvent document to ClickHouse row matching RFC schema', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => '667890abcdef1234567890ab' };

                const row = transformer.transformDocument(doc);

                // Resource identifiers
                expect(row.id).toBe('audit-001');
                expect(row._uuid).toBe('audit-uuid-001');

                // Primary search param
                expect(row.recorded).toBe('2024-06-15 10:30:00.000');

                // Frequently filtered
                expect(row.action).toBe('E');

                // Agent references — prefers _uuid over reference
                expect(row.agent_who).toEqual([
                    'Practitioner/prac-uuid-123',
                    'Device/device-uuid-456'
                ]);
                expect(row.agent_altid).toEqual(['alt-prac-123']);

                // Entity references — prefers _uuid over reference
                expect(row.entity_what).toEqual([
                    'Patient/patient-uuid-789',
                    'Encounter/enc-uuid-012'
                ]);

                // Agent requestor (agent where requestor === true)
                expect(row.agent_requestor_who).toBe('Practitioner/prac-uuid-123');

                // purposeOfEvent as Array(Tuple(system, code)) — promoted from resource JSON
                expect(row.purpose_of_event).toEqual([
                    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }
                ]);

                // meta.security as Array(Tuple(system, code)) — named objects for JSONEachRow
                expect(row.meta_security).toEqual([
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }
                ]);

                // b.well internal columns
                expect(row._sourceAssigningAuthority).toBe('bwell');
                expect(row._sourceId).toBe('audit-001');

                // resource is the full document object (Native JSON, not stringified)
                expect(row.resource).toEqual(doc);
                expect(row.resource.resourceType).toBe('AuditEvent');
                expect(row.resource.id).toBe('audit-001');
            });

            test('returns null for document missing _uuid', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => 'abc123' };
                delete doc._uuid;

                const row = transformer.transformDocument(doc);
                expect(row).toBeNull();
            });

            test('returns null for document missing recorded', () => {
                const transformer = new AuditEventTransformer();
                const doc = deepcopy(auditEventSample);
                doc._id = { toString: () => 'abc123' };
                delete doc.recorded;

                const row = transformer.transformDocument(doc);
                expect(row).toBeNull();
            });

            test('handles missing optional fields with defaults', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    resourceType: 'AuditEvent',
                    id: 'minimal-audit',
                    _uuid: 'minimal-uuid',
                    meta: { lastUpdated: '2024-01-01T00:00:00.000Z' },
                    recorded: '2024-01-01T00:00:00.000Z'
                };

                const row = transformer.transformDocument(doc);

                expect(row).not.toBeNull();
                expect(row.id).toBe('minimal-audit');
                expect(row._uuid).toBe('minimal-uuid');
                expect(row.action).toBe('');
                expect(row.agent_who).toEqual([]);
                expect(row.agent_altid).toEqual([]);
                expect(row.entity_what).toEqual([]);
                expect(row.agent_requestor_who).toBe('');
                expect(row.purpose_of_event).toEqual([]);
                expect(row.meta_security).toEqual([]);
                expect(row._sourceAssigningAuthority).toBe('');
                expect(row._sourceId).toBe('');
            });

            test('prefers _uuid over reference in agent.who', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    agent: [
                        {
                            who: {
                                reference: 'Practitioner/local-id',
                                _uuid: 'Practitioner/global-uuid'
                            }
                        }
                    ]
                };

                const row = transformer.transformDocument(doc);
                expect(row.agent_who).toEqual(['Practitioner/global-uuid']);
            });

            test('falls back to reference when _uuid is absent', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    agent: [{ who: { reference: 'Practitioner/local-id' } }],
                    entity: [{ what: { reference: 'Patient/local-patient' } }]
                };

                const row = transformer.transformDocument(doc);
                expect(row.agent_who).toEqual(['Practitioner/local-id']);
                expect(row.entity_what).toEqual(['Patient/local-patient']);
            });

            test('extracts agent_requestor_who from agent with requestor=true', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    agent: [
                        { who: { _uuid: 'Device/dev-1' }, requestor: false },
                        { who: { _uuid: 'Practitioner/prac-1' }, requestor: true }
                    ]
                };

                const row = transformer.transformDocument(doc);
                expect(row.agent_requestor_who).toBe('Practitioner/prac-1');
            });

            test('returns empty string for agent_requestor_who when no requestor', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    agent: [{ who: { _uuid: 'Device/dev-1' }, requestor: false }]
                };

                const row = transformer.transformDocument(doc);
                expect(row.agent_requestor_who).toBe('');
            });

            test('extracts meta_security as tuples', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                            { system: 'https://www.icanbwell.com/access', code: 'client' }
                        ]
                    }
                };

                const row = transformer.transformDocument(doc);
                expect(row.meta_security).toEqual([
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/access', code: 'client' }
                ]);
            });

            test('extracts purpose_of_event from purposeOfEvent codings', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    purposeOfEvent: [
                        {
                            coding: [
                                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT', display: 'treatment' },
                                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HOPERAT', display: 'healthcare operations' }
                            ]
                        },
                        {
                            coding: [
                                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'PATRQT', display: 'patient requested' }
                            ]
                        }
                    ]
                };

                const row = transformer.transformDocument(doc);
                expect(row.purpose_of_event).toEqual([
                    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' },
                    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HOPERAT' },
                    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'PATRQT' }
                ]);
            });

            test('skips purposeOfEvent codings missing system or code', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    purposeOfEvent: [
                        {
                            coding: [
                                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' },
                                { system: 'missing-code' },
                                { code: 'missing-system' }
                            ]
                        },
                        { text: 'no coding array' }
                    ]
                };

                const row = transformer.transformDocument(doc);
                expect(row.purpose_of_event).toEqual([
                    { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }
                ]);
            });

            test('skips security tags missing system or code', () => {
                const transformer = new AuditEventTransformer();
                const doc = {
                    _id: { toString: () => 'abc123' },
                    _uuid: 'test-uuid',
                    recorded: '2024-01-01T00:00:00.000Z',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                            { system: 'missing-code' },
                            { code: 'missing-system' }
                        ]
                    }
                };

                const row = transformer.transformDocument(doc);
                expect(row.meta_security).toEqual([{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }]);
            });
        });

        describe('transformBatch', () => {
            test('transforms array and tracks skipped docs', () => {
                const transformer = new AuditEventTransformer();
                const valid = deepcopy(auditEventSample);
                valid._id = { toString: () => 'aaa' };
                const invalid = { _id: { toString: () => 'bbb' } }; // missing _uuid and recorded

                const { rows, skipped } = transformer.transformBatch([valid, invalid]);
                expect(rows).toHaveLength(1);
                expect(skipped).toBe(1);
                expect(rows[0]._uuid).toBe('audit-uuid-001');
            });
        });

        describe('toClickHouseDateTime', () => {
            test('converts ISO string', () => {
                const transformer = new AuditEventTransformer();
                expect(transformer.toClickHouseDateTime('2024-06-15T10:30:00.000Z')).toBe(
                    '2024-06-15 10:30:00.000'
                );
            });

            test('converts Date object', () => {
                const transformer = new AuditEventTransformer();
                const result = transformer.toClickHouseDateTime(
                    new Date('2024-01-01T00:00:00.000Z')
                );
                expect(result).toBe('2024-01-01 00:00:00.000');
            });
        });
    });

    describe('generateHourlyPartitions', () => {
        test('generates correct hourly range within a single day', () => {
            const hours = generateHourlyPartitions('2024-01-01T00', '2024-01-01T04');
            expect(hours).toEqual([
                '2024-01-01T00',
                '2024-01-01T01',
                '2024-01-01T02',
                '2024-01-01T03'
            ]);
        });

        test('handles day boundary', () => {
            const hours = generateHourlyPartitions('2024-01-01T22', '2024-01-02T02');
            expect(hours).toEqual([
                '2024-01-01T22',
                '2024-01-01T23',
                '2024-01-02T00',
                '2024-01-02T01'
            ]);
        });

        test('handles year boundary', () => {
            const hours = generateHourlyPartitions('2023-12-31T23', '2024-01-01T02');
            expect(hours).toEqual([
                '2023-12-31T23',
                '2024-01-01T00',
                '2024-01-01T01'
            ]);
        });

        test('returns empty for same start and end', () => {
            expect(generateHourlyPartitions('2024-01-01T00', '2024-01-01T00')).toEqual([]);
        });

        test('produces 24 hours per day', () => {
            const hours = generateHourlyPartitions('2024-01-01T00', '2024-01-02T00');
            expect(hours).toHaveLength(24);
            expect(hours[0]).toBe('2024-01-01T00');
            expect(hours[23]).toBe('2024-01-01T23');
        });
    });

    describe('hourKey conversions', () => {
        test('hourKeyFromDate zero-pads month/day/hour', () => {
            expect(hourKeyFromDate(new Date('2024-05-03T07:00:00.000Z'))).toBe('2024-05-03T07');
        });

        test('hourKeyToDate round-trips through hourKeyFromDate', () => {
            const d = hourKeyToDate('2024-05-10T15');
            expect(d.toISOString()).toBe('2024-05-10T15:00:00.000Z');
            expect(hourKeyFromDate(d)).toBe('2024-05-10T15');
        });
    });

    describe('toClickHouseDateTime64', () => {
        // ClickHouse DateTime64(3, 'UTC') parameter binder rejects the ISO-8601 'Z'
        // suffix. Regression guard: stay on the space-separated, suffix-less form.
        test('formats as YYYY-MM-DD HH:MM:SS.sss without T or Z', () => {
            expect(toClickHouseDateTime64(new Date('2025-03-01T00:00:00.000Z')))
                .toBe('2025-03-01 00:00:00.000');
            expect(toClickHouseDateTime64(new Date('2024-05-10T15:30:45.123Z')))
                .toBe('2024-05-10 15:30:45.123');
        });
    });

    describe('normalizeCliDateToHour', () => {
        test('bare date with kind=start expands to T00', () => {
            expect(normalizeCliDateToHour('2024-05-10', 'start')).toBe('2024-05-10T00');
        });

        test('bare date with kind=end advances one day (so the full last day is included)', () => {
            expect(normalizeCliDateToHour('2024-05-10', 'end')).toBe('2024-05-11T00');
        });

        test('bare date with kind=end rolls over month boundary', () => {
            expect(normalizeCliDateToHour('2024-01-31', 'end')).toBe('2024-02-01T00');
        });

        test('date+hour passes through unchanged', () => {
            expect(normalizeCliDateToHour('2024-05-10T15', 'start')).toBe('2024-05-10T15');
            expect(normalizeCliDateToHour('2024-05-10T15', 'end')).toBe('2024-05-10T15');
        });

        test('rejects malformed input', () => {
            expect(() => normalizeCliDateToHour('2024/05/10', 'start')).toThrow(/expected/);
        });

        test('rejects non-calendar dates', () => {
            expect(() => normalizeCliDateToHour('2025-02-30', 'start')).toThrow(/not a real calendar/);
        });

        test('rejects hour out of range', () => {
            expect(() => normalizeCliDateToHour('2024-05-10T24', 'start')).toThrow(/hour must be 00-23/);
        });
    });

    describe('parseMonthArg', () => {
        test('mid-year month returns toYYYYMM partition id and full-month hour bounds', () => {
            expect(parseMonthArg('2026-03')).toEqual({
                partitionId: 202603,
                startHour: '2026-03-01T00',
                endHour: '2026-04-01T00',
                yyyyMm: '2026-03'
            });
        });

        test('December wraps to next year for endHour', () => {
            expect(parseMonthArg('2025-12')).toEqual({
                partitionId: 202512,
                startHour: '2025-12-01T00',
                endHour: '2026-01-01T00',
                yyyyMm: '2025-12'
            });
        });

        test('rejects malformed input', () => {
            expect(() => parseMonthArg('2026/03')).toThrow(/expected YYYY-MM/);
            expect(() => parseMonthArg('2026-3')).toThrow(/expected YYYY-MM/);
        });

        test('rejects invalid month', () => {
            expect(() => parseMonthArg('2026-13')).toThrow(/month must be 01-12/);
            expect(() => parseMonthArg('2026-00')).toThrow(/month must be 01-12/);
        });
    });

    describe('hourBoundsFromCli', () => {
        test('rejects when end <= start (after expansion)', () => {
            // Hour-form equal endpoints never cover any range.
            expect(() => hourBoundsFromCli('2024-05-10T05', '2024-05-10T05')).toThrow(
                /must be strictly after/
            );
            // Start day strictly after end day also rejected.
            expect(() => hourBoundsFromCli('2024-05-11', '2024-05-10')).toThrow(
                /must be strictly after/
            );
        });

        test('bare date pair covers full days inclusively', () => {
            expect(hourBoundsFromCli('2024-05-10', '2024-05-11')).toEqual({
                startHour: '2024-05-10T00',
                endHour: '2024-05-12T00'
            });
        });

        test('mixed date + hour works', () => {
            expect(hourBoundsFromCli('2024-05-10', '2024-05-10T03')).toEqual({
                startHour: '2024-05-10T00',
                endHour: '2024-05-10T03'
            });
        });
    });

    describe('defaultDateRange', () => {
        test('spans 13 full months ending at the start of next month', () => {
            // April 24 2026 → start = first day of March 2025 (13 months back),
            // end exclusive = first day of May 2026.
            const { startDate, endDate } = defaultDateRange(
                new Date('2026-04-24T12:00:00.000Z')
            );
            expect(startDate).toBe('2025-03-01');
            expect(endDate).toBe('2026-05-01');
        });

        test('handles year boundary when anchored in early January', () => {
            const { startDate, endDate } = defaultDateRange(
                new Date('2026-01-05T00:00:00.000Z')
            );
            expect(startDate).toBe('2024-12-01');
            expect(endDate).toBe('2026-02-01');
        });

        test('start is always a real calendar first-of-month', () => {
            const { startDate } = defaultDateRange(new Date('2026-03-31T23:00:00.000Z'));
            expect(startDate).toMatch(/^\d{4}-\d{2}-01$/);
        });
    });

    describe('PartitionWorker.processAsync retry semantics', () => {
        function makeFakes({ sourceDocs = [] } = {}) {
            const calls = [];
            let cursorIdx = 0;
            const clickHouseClientManager = {
                queryAsync: jest.fn(async ({ query }) => {
                    calls.push({ type: 'ch.query', query });
                    return [];
                }),
                insertAsync: jest.fn(async () => {
                    calls.push({ type: 'ch.insert' });
                })
            };
            const stateManager = {
                clearInsertedCountAsync: jest.fn(async () => {
                    calls.push({ type: 'state.clear' });
                }),
                markInProgressAsync: jest.fn(async () => {
                    calls.push({ type: 'state.inProgress' });
                }),
                updateProgressAsync: jest.fn(async ({ insertedCount }) => {
                    calls.push({ type: 'state.progress', insertedCount });
                }),
                markCompletedAsync: jest.fn(async ({ insertedCount, sourceCount }) => {
                    calls.push({ type: 'state.completed', insertedCount, sourceCount });
                }),
                markFailedAsync: jest.fn()
            };
            const sourceDb = {
                databaseName: 'fhir',
                collection: () => ({
                    countDocuments: jest.fn(async () => {
                        calls.push({ type: 'mongo.count' });
                        return sourceDocs.length;
                    }),
                    find: jest.fn(() => ({
                        batchSize: () => ({
                            hasNext: jest.fn(async () => cursorIdx < sourceDocs.length),
                            next: jest.fn(async () => sourceDocs[cursorIdx++]),
                            close: jest.fn(async () => {})
                        })
                    }))
                })
            };
            return { calls, clickHouseClientManager, stateManager, sourceDb };
        }

        test('default (rewriteExisting=false) skips partition with prior inserts', async () => {
            const { calls, clickHouseClientManager, stateManager, sourceDb } = makeFakes();

            const worker = new PartitionWorker({
                sourceDb,
                collectionName: 'AuditEvent_4_0_0',
                clickHouseClientManager,
                stateManager,
                batchSize: 100
            });

            const result = await worker.processAsync({
                partitionHour: '2024-05-10T05',
                priorInsertedCount: 42
            });

            expect(result.skippedReason).toBe('priorInsertedCount>0');
            expect(clickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(stateManager.clearInsertedCountAsync).not.toHaveBeenCalled();
            expect(stateManager.markCompletedAsync).not.toHaveBeenCalled();
            // No Mongo read either — skip must short-circuit the whole hour.
            expect(calls.every((c) => !c.type.startsWith('mongo'))).toBe(true);
        });

        test('rewriteExisting=true (--resume) DELETEs before Mongo when priorInsertedCount>0', async () => {
            const { calls, clickHouseClientManager, stateManager, sourceDb } = makeFakes();

            const worker = new PartitionWorker({
                sourceDb,
                collectionName: 'AuditEvent_4_0_0',
                clickHouseClientManager,
                stateManager,
                batchSize: 100,
                rewriteExisting: true
            });

            await worker.processAsync({ partitionHour: '2024-05-10T05', priorInsertedCount: 42 });

            const firstMongo = calls.findIndex((c) => c.type.startsWith('mongo'));
            const firstDelete = calls.findIndex(
                (c) => c.type === 'ch.query' && /ALTER TABLE fhir\.AuditEvent_4_0_0\s+DELETE/.test(c.query)
            );
            expect(firstDelete).toBeGreaterThanOrEqual(0);
            expect(firstDelete).toBeLessThan(firstMongo);
            expect(stateManager.clearInsertedCountAsync).toHaveBeenCalledWith('2024-05-10T05');
        });

        test('rewriteExisting=true (--resume) DELETEs even when priorInsertedCount is 0', async () => {
            // Covers the case where a prior crash landed rows in ClickHouse but
            // never persisted inserted_count. The operator asked for the
            // destructive path; we honor it regardless of the state counter.
            const { calls, clickHouseClientManager, stateManager, sourceDb } = makeFakes();

            const worker = new PartitionWorker({
                sourceDb,
                collectionName: 'AuditEvent_4_0_0',
                clickHouseClientManager,
                stateManager,
                batchSize: 100,
                rewriteExisting: true
            });

            await worker.processAsync({ partitionHour: '2024-05-10T05', priorInsertedCount: 0 });

            const deleteCall = calls.find(
                (c) => c.type === 'ch.query' && /ALTER TABLE fhir\.AuditEvent_4_0_0\s+DELETE/.test(c.query)
            );
            expect(deleteCall).toBeDefined();
            expect(stateManager.clearInsertedCountAsync).toHaveBeenCalledWith('2024-05-10T05');
        });

        test('default (rewriteExisting=false) + priorInsertedCount=0 → no DELETE', async () => {
            const { clickHouseClientManager, stateManager, sourceDb } = makeFakes();

            const worker = new PartitionWorker({
                sourceDb,
                collectionName: 'AuditEvent_4_0_0',
                clickHouseClientManager,
                stateManager,
                batchSize: 100
            });

            await worker.processAsync({ partitionHour: '2024-05-10T05', priorInsertedCount: 0 });

            expect(clickHouseClientManager.queryAsync).not.toHaveBeenCalled();
            expect(stateManager.clearInsertedCountAsync).not.toHaveBeenCalled();
        });

        test('updates state row after each batch with running insertedCount', async () => {
            // 3 docs with _uuid + recorded so the transformer keeps them all, batch
            // size 2 → first batch of 2 + final batch of 1 → two progress updates.
            const sourceDocs = [
                { _id: { toString: () => 'a' }, _uuid: 'u1', recorded: '2024-05-10T05:00:00.000Z' },
                { _id: { toString: () => 'b' }, _uuid: 'u2', recorded: '2024-05-10T05:01:00.000Z' },
                { _id: { toString: () => 'c' }, _uuid: 'u3', recorded: '2024-05-10T05:02:00.000Z' }
            ];
            const { calls, clickHouseClientManager, stateManager, sourceDb } = makeFakes({ sourceDocs });

            const worker = new PartitionWorker({
                sourceDb,
                collectionName: 'AuditEvent_4_0_0',
                clickHouseClientManager,
                stateManager,
                batchSize: 2
            });

            const result = await worker.processAsync({
                partitionHour: '2024-05-10T05',
                priorInsertedCount: 0
            });

            expect(result.insertedCount).toBe(3);
            const progressCalls = calls.filter((c) => c.type === 'state.progress');
            expect(progressCalls).toHaveLength(1);
            expect(progressCalls[0].insertedCount).toBe(2);
            const completed = calls.find((c) => c.type === 'state.completed');
            expect(completed.insertedCount).toBe(3);
            expect(completed.sourceCount).toBe(3);
        });
    });
});
