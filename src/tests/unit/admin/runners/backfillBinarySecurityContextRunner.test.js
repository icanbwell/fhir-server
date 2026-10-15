const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');
const { ObjectId } = require('mongodb');

const {
    BackfillBinarySecurityContextRunner,
    resolveBinaryUuidFromAttachmentUrl
} = require('../../../../admin/runners/backfillBinarySecurityContextRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const createMockInstance = (ClassType) => Object.create(ClassType.prototype);

const BINARY_UUID = '3f1c2c7e-9a54-5d0e-8b6a-0d3f4b1c2a90';
const PATIENT_UUID = 'Patient/24a5930e-11b4-5525-b482-669174917044';
const OTHER_PATIENT_UUID = 'Patient/9b8f2c1d-0000-5525-b482-669174917044';

const subject = (uuid = PATIENT_UUID) => ({
    reference: 'Patient/p1',
    _uuid: uuid,
    _sourceId: 'Patient/p1',
    _sourceAssigningAuthority: 'client'
});

const documentReference = (url, subjectValue = subject(), extra = {}) => ({
    _id: new ObjectId(),
    _uuid: 'dr-uuid',
    _sourceAssigningAuthority: 'client',
    subject: subjectValue,
    content: [{ attachment: { url } }],
    ...extra
});

describe('resolveBinaryUuidFromAttachmentUrl', () => {
    test('a uuid id is used as is', () => {
        expect(resolveBinaryUuidFromAttachmentUrl({ url: `Binary/${BINARY_UUID}`, sourceAssigningAuthority: 'client' }))
            .toBe(BINARY_UUID);
    });

    test('a non-uuid id becomes the uuid for id|sourceAssigningAuthority, like $everything', () => {
        expect(resolveBinaryUuidFromAttachmentUrl({ url: 'Binary/abc', sourceAssigningAuthority: 'client' }))
            .toBe(generateUUIDv5('abc|client'));
    });

    test.each([
        ['a non-Binary reference', 'Patient/abc'],
        ['an http url', 'https://example.com/Binary/abc'],
        ['an empty string', ''],
        ['undefined', undefined]
    ])('%s is ignored', (_name, url) => {
        expect(resolveBinaryUuidFromAttachmentUrl({ url, sourceAssigningAuthority: 'client' })).toBeNull();
    });
});

describe('BackfillBinarySecurityContextRunner', () => {
    let runner;
    let binaryCollection;

    const createRunner = (options = {}) => {
        const adminLogger = createMockInstance(AdminLogger);
        adminLogger.logInfo = jestGlobal.fn();
        adminLogger.logError = jestGlobal.fn();
        const mongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        const created = new BackfillBinarySecurityContextRunner({
            batchSize: 100,
            adminLogger,
            mongoDatabaseManager,
            ...options
        });
        created.binaryCollection = binaryCollection;
        return created;
    };

    beforeEach(() => {
        binaryCollection = { findOne: jestGlobal.fn().mockResolvedValue({ _id: new ObjectId() }) };
        runner = createRunner();
    });

    describe('constructor', () => {
        test('rejects an invalid startFromId', () => {
            expect(() => createRunner({ startFromId: 'nope' })).toThrow('Invalid startFromId');
        });
    });

    describe('getOwnerSecurityContext', () => {
        test('copies the stored subject fields of a Patient', () => {
            expect(runner.getOwnerSecurityContext(subject())).toStrictEqual({
                reference: 'Patient/p1',
                _uuid: PATIENT_UUID,
                _sourceId: 'Patient/p1',
                _sourceAssigningAuthority: 'client'
            });
        });

        test.each([
            ['a Person', { _uuid: 'Person/abc' }],
            ['a Group', { _uuid: 'Group/abc' }],
            ['no _uuid', { reference: 'Patient/p1' }],
            ['no subject', undefined]
        ])('%s is not an owner', (_name, value) => {
            expect(runner.getOwnerSecurityContext(value)).toBeNull();
        });
    });

    describe('getQuery', () => {
        test('scans DocumentReference with a Binary url and a Patient subject', () => {
            const query = runner.getQuery();
            expect(query.$and).toContainEqual({ 'content.attachment.url': { $regex: 'Binary/' } });
            expect(query.$and).toContainEqual({ 'subject._uuid': { $regex: '^Patient/' } });
        });

        test('adds the lastUpdated window and the resume id', () => {
            const before = new Date('2024-02-01');
            const after = new Date('2024-01-01');
            const startFromId = new ObjectId().toString();
            const query = createRunner({ beforeLastUpdatedDate: before, afterLastUpdatedDate: after, startFromId }).getQuery();
            expect(query.$and).toContainEqual({ 'meta.lastUpdated': { $lt: before, $gt: after } });
            expect(query.$and).toContainEqual({ _id: { $gte: new ObjectId(startFromId) } });
        });
    });

    describe('processRecordsAsync', () => {
        test('sets securityContext from the subject, only where it is missing', async () => {
            const ops = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            expect(ops).toStrictEqual([{
                updateOne: {
                    filter: { _uuid: BINARY_UUID, securityContext: { $exists: false } },
                    update: {
                        $set: {
                            securityContext: {
                                reference: 'Patient/p1',
                                _uuid: PATIENT_UUID,
                                _sourceId: 'Patient/p1',
                                _sourceAssigningAuthority: 'client'
                            }
                        }
                    }
                }
            }]);
            expect(runner.stats.queued).toBe(1);
        });

        test('never touches meta or data', async () => {
            const [op] = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            expect(Object.keys(op.updateOne.update)).toStrictEqual(['$set']);
            expect(Object.keys(op.updateOne.update.$set)).toStrictEqual(['securityContext']);
        });

        test('resolves a non-uuid Binary id with the DocumentReference sourceAssigningAuthority', async () => {
            await runner.processRecordsAsync({ doc: documentReference('Binary/abc') });
            expect(binaryCollection.findOne.mock.calls[0][0]).toStrictEqual({ _uuid: generateUUIDv5('abc|client') });
        });

        test('skips a DocumentReference whose subject is not a Patient', async () => {
            const ops = await runner.processRecordsAsync({
                doc: documentReference(`Binary/${BINARY_UUID}`, { _uuid: 'Person/abc' })
            });
            expect(ops).toStrictEqual([]);
            expect(runner.stats.skippedSubjectNotPatient).toBe(1);
            expect(binaryCollection.findOne).not.toHaveBeenCalled();
        });

        test('skips a DocumentReference with no Binary url', async () => {
            const ops = await runner.processRecordsAsync({ doc: documentReference('Patient/abc') });
            expect(ops).toStrictEqual([]);
            expect(runner.stats.skippedNoBinaryUrl).toBe(1);
        });

        test('counts a Binary that does not exist', async () => {
            binaryCollection.findOne.mockResolvedValue(null);
            const ops = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            expect(ops).toStrictEqual([]);
            expect(runner.stats.binaryNotFound).toBe(1);
        });

        test('is idempotent: a Binary already owned by the same Patient is left alone', async () => {
            binaryCollection.findOne.mockResolvedValue({ _id: new ObjectId(), securityContext: { _uuid: PATIENT_UUID } });
            const ops = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            expect(ops).toStrictEqual([]);
            expect(runner.stats.alreadyOwnedBySame).toBe(1);
            expect(runner.stats.conflicts).toBe(0);
        });

        test('a Binary already owned by someone else is a conflict and is not changed', async () => {
            binaryCollection.findOne.mockResolvedValue({
                _id: new ObjectId(),
                securityContext: { _uuid: OTHER_PATIENT_UUID }
            });
            const ops = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            expect(ops).toStrictEqual([]);
            expect(runner.stats.conflicts).toBe(1);
            expect(runner.conflicts[0]).toMatchObject({
                binaryUuid: BINARY_UUID, keptOwner: OTHER_PATIENT_UUID, otherOwner: PATIENT_UUID
            });
        });

        test('two DocumentReferences with different subjects in one batch: first wins, second is a conflict', async () => {
            const first = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            const second = await runner.processRecordsAsync({
                doc: documentReference(`Binary/${BINARY_UUID}`, subject(OTHER_PATIENT_UUID))
            });
            expect(first).toHaveLength(1);
            expect(second).toStrictEqual([]);
            expect(runner.stats.conflicts).toBe(1);
            expect(binaryCollection.findOne).toHaveBeenCalledTimes(1);
        });

        test('two DocumentReferences with the same subject: one write, no conflict', async () => {
            await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            const second = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            expect(second).toStrictEqual([]);
            expect(runner.stats.conflicts).toBe(0);
            expect(runner.stats.alreadyOwnedBySame).toBe(1);
        });

        test('one DocumentReference with several Binary urls queues one update per Binary', async () => {
            const doc = documentReference(`Binary/${BINARY_UUID}`, subject(), {
                content: [
                    { attachment: { url: `Binary/${BINARY_UUID}` } },
                    { attachment: { url: `Binary/${BINARY_UUID}` } },
                    { attachment: { url: 'Binary/other' } }
                ]
            });
            const ops = await runner.processRecordsAsync({ doc });
            expect(ops).toHaveLength(2);
        });

        test('dry run counts what would be written and writes nothing', async () => {
            runner = createRunner({ dryRun: true });
            const ops = await runner.processRecordsAsync({ doc: documentReference(`Binary/${BINARY_UUID}`) });
            expect(ops).toStrictEqual([]);
            expect(runner.stats.queued).toBe(1);
        });
    });
});
