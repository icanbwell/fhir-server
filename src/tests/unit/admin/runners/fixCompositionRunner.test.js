'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixCompositionRunner } = require('../../../../admin/runners/fixCompositionRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { DatabaseHistoryFactory } = require('../../../../dataLayer/databaseHistoryFactory');
const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

const COMPOSITION_TITLE = 'Encounter Summary Grouped by Encounter Class and Type';

function makeCompositionDoc ({ sections, uuid = 'comp-uuid-1' } = {}) {
    return {
        _id: 'mongo-1',
        resourceType: 'Composition',
        id: 'c1',
        _uuid: uuid,
        _sourceId: 'c1',
        _sourceAssigningAuthority: 'tenantA',
        status: 'final',
        type: { text: 'summary' },
        date: '2024-01-01',
        author: [{ reference: 'Organization/o1' }],
        title: COMPOSITION_TITLE,
        meta: {
            versionId: '2',
            security: [
                { system: SecurityTagSystem.owner, code: 'tenantA' },
                { system: SecurityTagSystem.access, code: 'tenantA' },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' }
            ]
        },
        section: sections === undefined
            ? [{
                title: 'AMB',
                entry: [{ reference: 'Encounter/e1' }],
                code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'NEW' }] }
            }]
            : sections
    };
}

function makeHistoryComposition (sections) {
    return FhirResourceCreator.create({
        resourceType: 'Composition',
        id: 'c1',
        _uuid: 'comp-uuid-1',
        status: 'final',
        type: { text: 'summary' },
        date: '2024-01-01',
        author: [{ reference: 'Organization/o1' }],
        title: COMPOSITION_TITLE,
        section: sections
    });
}

describe('FixCompositionRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockDatabaseHistoryFactory;
    let mockDatabaseHistoryManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });

        mockDatabaseHistoryManager = { findOneAsync: jestGlobal.fn().mockResolvedValue(null) };
        mockDatabaseHistoryFactory = createMockInstance(DatabaseHistoryFactory);
        mockDatabaseHistoryFactory.createDatabaseHistoryManager = jestGlobal.fn()
            .mockReturnValue(mockDatabaseHistoryManager);

        runner = new FixCompositionRunner({
            databaseHistoryFactory: mockDatabaseHistoryFactory,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            batchSize: 100
        });
    });

    // =====================================================
    // constructor
    // =====================================================
    describe('constructor', () => {
        test('rejects a databaseHistoryFactory that is not a DatabaseHistoryFactory', () => {
            expect(() => new FixCompositionRunner({
                databaseHistoryFactory: { createDatabaseHistoryManager: () => {} },
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                batchSize: 100
            })).toThrow();
        });

        test('pins the runner to the Composition collection', () => {
            expect(runner.compositionCollectionName).toBe('Composition_4_0_0');
        });
    });

    // =====================================================
    // getRecentHistory
    // =====================================================
    describe('getRecentHistory', () => {
        test('looks up history by resource._uuid ordered by descending versionId', async () => {
            await runner.getRecentHistory('comp-uuid-1', 'Composition');

            expect(mockDatabaseHistoryFactory.createDatabaseHistoryManager)
                .toHaveBeenCalledWith({ resourceType: 'Composition', base_version: '4_0_0' });
            expect(mockDatabaseHistoryManager.findOneAsync).toHaveBeenCalledWith({
                query: { 'resource._uuid': 'comp-uuid-1' },
                options: { sort: { 'resource.meta.versionId': -1 } }
            });
        });

        test('returns null when the resource has no history', async () => {
            mockDatabaseHistoryManager.findOneAsync.mockResolvedValue(null);

            await expect(runner.getRecentHistory('comp-uuid-1', 'Composition'))
                .resolves.toBeNull();
        });

        test('unwraps the doubly-nested bundle-entry shape (resource.resource)', async () => {
            mockDatabaseHistoryManager.findOneAsync.mockResolvedValue({
                resource: {
                    resource: {
                        resourceType: 'Composition',
                        id: 'c1',
                        status: 'final',
                        type: { text: 'summary' },
                        date: '2024-01-01',
                        author: [{ reference: 'Organization/o1' }],
                        title: 'from-nested'
                    }
                }
            });

            const result = await runner.getRecentHistory('comp-uuid-1', 'Composition');

            expect(result.title).toBe('from-nested');
            expect(result.resourceType).toBe('Composition');
        });

        test('unwraps the flat history shape (resource)', async () => {
            mockDatabaseHistoryManager.findOneAsync.mockResolvedValue({
                resource: {
                    resourceType: 'Composition',
                    id: 'c1',
                    status: 'final',
                    type: { text: 'summary' },
                    date: '2024-01-01',
                    author: [{ reference: 'Organization/o1' }],
                    title: 'from-flat'
                }
            });

            const result = await runner.getRecentHistory('comp-uuid-1', 'Composition');

            expect(result.title).toBe('from-flat');
        });
    });

    // =====================================================
    // revertCodeableConceptChanges
    // =====================================================
    describe('revertCodeableConceptChanges', () => {
        test('returns the resource untouched when it has no sections', async () => {
            const resource = FhirResourceCreator.create(makeCompositionDoc({ sections: null }));

            const result = await runner.revertCodeableConceptChanges(resource);

            expect(result).toBe(resource);
            expect(mockDatabaseHistoryFactory.createDatabaseHistoryManager).not.toHaveBeenCalled();
        });

        test('returns the resource untouched when no history exists', async () => {
            const resource = FhirResourceCreator.create(makeCompositionDoc());
            mockDatabaseHistoryManager.findOneAsync.mockResolvedValue(null);

            const result = await runner.revertCodeableConceptChanges(resource);

            expect(result.section[0].code.coding[0].code).toBe('NEW');
        });

        test('restores the first coding of a section matched on title and first entry reference', async () => {
            const resource = FhirResourceCreator.create(makeCompositionDoc());
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'AMB',
                entry: [{ reference: 'Encounter/e1' }],
                code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'OLD' }] }
            }]));

            const result = await runner.revertCodeableConceptChanges(resource);

            expect(result.section[0].code.coding[0].code).toBe('OLD');
        });

        test('does not restore when the history section title differs', async () => {
            const resource = FhirResourceCreator.create(makeCompositionDoc());
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'IMP',
                entry: [{ reference: 'Encounter/e1' }],
                code: { coding: [{ system: 'http://x', code: 'OLD' }] }
            }]));

            const result = await runner.revertCodeableConceptChanges(resource);

            expect(result.section[0].code.coding[0].code).toBe('NEW');
        });

        test('does not restore when the history section points at a different entry', async () => {
            const resource = FhirResourceCreator.create(makeCompositionDoc());
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'AMB',
                entry: [{ reference: 'Encounter/DIFFERENT' }],
                code: { coding: [{ system: 'http://x', code: 'OLD' }] }
            }]));

            const result = await runner.revertCodeableConceptChanges(resource);

            expect(result.section[0].code.coding[0].code).toBe('NEW');
        });

        test('restores only the first coding and leaves later codings alone', async () => {
            const doc = makeCompositionDoc({
                sections: [{
                    title: 'AMB',
                    entry: [{ reference: 'Encounter/e1' }],
                    code: {
                        coding: [
                            { system: 'http://x', code: 'NEW' },
                            { system: 'http://y', code: 'KEEP-ME' }
                        ]
                    }
                }]
            });
            const resource = FhirResourceCreator.create(doc);
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'AMB',
                entry: [{ reference: 'Encounter/e1' }],
                code: {
                    coding: [
                        { system: 'http://x', code: 'OLD' },
                        { system: 'http://z', code: 'HISTORY-ONLY' }
                    ]
                }
            }]));

            const result = await runner.revertCodeableConceptChanges(resource);

            expect(result.section[0].code.coding[0].code).toBe('OLD');
            expect(result.section[0].code.coding[1].code).toBe('KEEP-ME');
        });

        test('restores every matching section when the composition has several', async () => {
            const doc = makeCompositionDoc({
                sections: [
                    {
                        title: 'AMB',
                        entry: [{ reference: 'Encounter/e1' }],
                        code: { coding: [{ system: 'http://x', code: 'NEW-1' }] }
                    },
                    {
                        title: 'IMP',
                        entry: [{ reference: 'Encounter/e2' }],
                        code: { coding: [{ system: 'http://x', code: 'NEW-2' }] }
                    }
                ]
            });
            const resource = FhirResourceCreator.create(doc);
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([
                {
                    title: 'AMB',
                    entry: [{ reference: 'Encounter/e1' }],
                    code: { coding: [{ system: 'http://x', code: 'OLD-1' }] }
                },
                {
                    title: 'IMP',
                    entry: [{ reference: 'Encounter/e2' }],
                    code: { coding: [{ system: 'http://x', code: 'OLD-2' }] }
                }
            ]));

            const result = await runner.revertCodeableConceptChanges(resource);

            expect(result.section.map((s) => s.code.coding[0].code)).toEqual(['OLD-1', 'OLD-2']);
        });

        test('wraps a history lookup failure in a RethrownError', async () => {
            const resource = FhirResourceCreator.create(makeCompositionDoc());
            runner.getRecentHistory = jestGlobal.fn()
                .mockRejectedValue(new Error('history db down'));

            await expect(runner.revertCodeableConceptChanges(resource))
                .rejects.toThrow(/Error reverting changes history db down/);
        });
    });

    // =====================================================
    // processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('returns no operations when the revert is a no-op', async () => {
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'AMB',
                entry: [{ reference: 'Encounter/e1' }],
                code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'NEW' }] }
            }]));

            const operations = await runner.processRecordAsync(makeCompositionDoc());

            expect(operations).toEqual([]);
        });

        test('emits a replaceOne carrying the restored coding', async () => {
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'AMB',
                entry: [{ reference: 'Encounter/e1' }],
                code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'OLD' }] }
            }]));

            const operations = await runner.processRecordAsync(makeCompositionDoc());

            expect(operations).toHaveLength(1);
            expect(operations[0].replaceOne.filter).toEqual({ _id: 'mongo-1' });
            expect(operations[0].replaceOne.replacement.section[0].code.coding[0].code).toBe('OLD');
        });

        test('SEC-META-PRESERVE: the rewritten composition keeps owner/access/sourceAssigningAuthority tags', async () => {
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'AMB',
                entry: [{ reference: 'Encounter/e1' }],
                code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'OLD' }] }
            }]));

            const operations = await runner.processRecordAsync(makeCompositionDoc());

            const replacement = operations[0].replaceOne.replacement;
            expect(replacement.meta.security).toEqual(expect.arrayContaining([
                expect.objectContaining({ system: SecurityTagSystem.owner, code: 'tenantA' }),
                expect.objectContaining({ system: SecurityTagSystem.access, code: 'tenantA' }),
                expect.objectContaining({
                    system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA'
                })
            ]));
            expect(replacement._uuid).toBe('comp-uuid-1');
            expect(replacement._sourceAssigningAuthority).toBe('tenantA');
        });

        test('wraps processing failures in a RethrownError', async () => {
            await expect(runner.processRecordAsync(null))
                .rejects.toThrow(/Error processing record/);
        });

        test('a same-titled history section without an entry array crashes the record', async () => {
            // fixCompositionRunner.js:74-76 - the predicate guards `section.entry` but then
            // dereferences `s.entry[0].reference` on the HISTORY section without any guard. A
            // history version whose section has no entries (a legitimate FHIR Composition.section)
            // throws TypeError, which the catch turns into a RethrownError and aborts the whole
            // bulk batch. The correct behaviour is simply "no match" - leave the section alone.
            runner.getRecentHistory = jestGlobal.fn().mockResolvedValue(makeHistoryComposition([{
                title: 'AMB',
                code: { coding: [{ system: 'http://x', code: 'OLD' }] }
            }]));

            const operations = await runner.processRecordAsync(makeCompositionDoc());

            expect(operations).toEqual([]);
        });
    });

    // =====================================================
    // processAsync
    // =====================================================
    describe('processAsync', () => {
        test('scans only the grouped-encounter-summary compositions in Composition_4_0_0', async () => {
            runner.runForQueryBatchesAsync = jestGlobal.fn().mockResolvedValue('done');

            await runner.processAsync();

            const call = runner.runForQueryBatchesAsync.mock.calls[0][0];
            expect(call.query).toEqual({ title: COMPOSITION_TITLE });
            expect(call.sourceCollectionName).toBe('Composition_4_0_0');
            expect(call.destinationCollectionName).toBe('Composition_4_0_0');
            expect(call.ordered).toBe(false);
            expect(call.skipExistingIds).toBe(false);
        });

        test('reports a batch failure through the admin logger', async () => {
            runner.runForQueryBatchesAsync = jestGlobal.fn()
                .mockRejectedValue(new Error('bulk write failed'));

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('bulk write failed'),
                expect.any(Object)
            );
        });
    });
});
