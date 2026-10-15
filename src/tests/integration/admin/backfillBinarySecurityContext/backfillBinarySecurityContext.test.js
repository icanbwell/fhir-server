// Backfill of Binary.securityContext from the subject of the DocumentReference that points at the Binary
// (design section 17). Seeds through the API as a system token, runs the runner against the test database and
// checks the stored documents directly.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const {
    BackfillBinarySecurityContextRunner
} = require('../../../../admin/runners/backfillBinarySecurityContextRunner');

const meta = {
    source: 'https://example.com/test',
    security: [
        { system: 'https://www.icanbwell.com/owner', code: 'client1' },
        { system: 'https://www.icanbwell.com/access', code: 'client1' }
    ]
};

const patient = (id) => ({ resourceType: 'Patient', id, meta, name: [{ family: id.toUpperCase() }] });
const binary = (id) => ({ resourceType: 'Binary', id, meta, contentType: 'application/pdf', data: 'JVBERi0xLjQK' });
const documentReference = (id, patientId, binaryIds) => ({
    resourceType: 'DocumentReference',
    id,
    meta,
    status: 'current',
    subject: { reference: `Patient/${patientId}` },
    content: binaryIds.map((b) => ({ attachment: { contentType: 'application/pdf', url: `Binary/${b}` } }))
});

describe('Backfill Binary.securityContext', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.backfillBinarySecurityContextRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const merge = async (request, resourceType, body) => {
        const resp = await request
            .post(`/4_0_0/${resourceType}/1/$merge?validate=true`)
            .send(body)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        return resp.body.uuid;
    };

    const runBackfill = async (options = {}) => {
        const container = getTestContainer();
        container.register(
            'backfillBinarySecurityContextRunner',
            (c) =>
                new BackfillBinarySecurityContextRunner({
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    batchSize: 10,
                    adminLogger: new AdminLogger(),
                    dryRun: false,
                    ...options
                })
        );
        const runner = container.backfillBinarySecurityContextRunner;
        await runner.processAsync();
        return runner;
    };

    const readBinary = async (id) => {
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return await db.collection('Binary_4_0_0').findOne({ id });
    };

    const seed = async (request) => {
        const patientA = await merge(request, 'Patient', patient('patient-a'));
        const patientB = await merge(request, 'Patient', patient('patient-b'));
        await merge(request, 'Binary', binary('binary-owned'));
        await merge(request, 'Binary', binary('binary-orphan'));
        await merge(request, 'Binary', binary('binary-conflict'));
        await merge(request, 'DocumentReference', documentReference('doc-1', 'patient-a', ['binary-owned']));
        await merge(request, 'DocumentReference', documentReference('doc-2', 'patient-a', ['binary-conflict']));
        await merge(request, 'DocumentReference', documentReference('doc-3', 'patient-b', ['binary-conflict']));
        return { patientA, patientB };
    };

    test('stamps the Patient the DocumentReference points at; leaves unreferenced Binary alone', async () => {
        const request = await createTestRequest();
        const { patientA } = await seed(request);

        const runner = await runBackfill();

        const owned = await readBinary('binary-owned');
        expect(owned.securityContext._uuid).toStrictEqual(`Patient/${patientA}`);
        expect(owned.securityContext._sourceId).toStrictEqual('Patient/patient-a');
        expect(owned.securityContext.reference).toStrictEqual('Patient/patient-a');
        // data and version are untouched
        expect(owned.data).toStrictEqual('JVBERi0xLjQK');
        expect(owned.meta.versionId).toStrictEqual('1');

        const orphan = await readBinary('binary-orphan');
        expect(orphan.securityContext).toBeUndefined();

        expect(runner.stats.queued).toBe(2);
    });

    test('a Binary reached by DocumentReferences with different subjects keeps the first owner and is reported', async () => {
        const request = await createTestRequest();
        await seed(request);

        const runner = await runBackfill();

        const conflicted = await readBinary('binary-conflict');
        expect(conflicted.securityContext._uuid).toMatch(/^Patient\//);
        expect(runner.stats.conflicts).toBe(1);
        expect(runner.conflicts[0].binaryUuid).toStrictEqual(conflicted._uuid);
    });

    test('is idempotent: a second run changes nothing and reports no new work', async () => {
        const request = await createTestRequest();
        await seed(request);
        await runBackfill();
        const before = await readBinary('binary-owned');

        const second = await runBackfill();

        const after = await readBinary('binary-owned');
        expect(after.securityContext).toStrictEqual(before.securityContext);
        expect(second.stats.queued).toBe(0);
    });

    test('a dry run writes nothing', async () => {
        const request = await createTestRequest();
        await seed(request);

        const runner = await runBackfill({ dryRun: true });

        expect((await readBinary('binary-owned')).securityContext).toBeUndefined();
        expect(runner.stats.queued).toBeGreaterThan(0);
    });

    test('does not overwrite an owner that is already set', async () => {
        const request = await createTestRequest();
        const { patientB } = await seed(request);
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        await db.collection('Binary_4_0_0').updateOne(
            { id: 'binary-owned' },
            { $set: { securityContext: { _uuid: `Patient/${patientB}`, _sourceId: 'Patient/patient-b' } } }
        );

        const runner = await runBackfill();

        expect((await readBinary('binary-owned')).securityContext._uuid).toStrictEqual(`Patient/${patientB}`);
        expect(runner.stats.conflicts).toBeGreaterThanOrEqual(1);
    });
});
