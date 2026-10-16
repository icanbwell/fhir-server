// OPT-IN, NOT part of the default suite: lives under src/tests/integration/performance/, which jest.config.js
// lists in testPathIgnorePatterns. Run explicitly:
//   NODE_ENV=test node node_modules/.bin/jest --config jest.config.js --runInBand --forceExit \
//     --runTestsByPath src/tests/integration/performance/binary_person_filter/binaryPersonFilterExplain.test.js \
//     --testPathIgnorePatterns=/nonexistent/
//
// Prints explain('executionStats') for the exact Mongo filter produced by
// PatientQueryCreator.getQueryWithPersonSecurityContext, before/after the securityContext indexes in
// src/indexes/customIndexes.js. Synthetic data only (design doc section 13).
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { randomUUID } = require('crypto');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../../common');

const COLLECTION = 'Binary_4_0_0';
const UNOWNED = Number(process.env.EXPLAIN_UNOWNED || 50000);
const PERSONS = 300; // one owned Binary each (proxy patient); a few also owned through a real Patient uuid
const REAL_PATIENTS = 20;
const CLIENT = 'client1';

const baseDoc = (uuid) => ({
    _uuid: uuid,
    _sourceId: uuid,
    _sourceAssigningAuthority: CLIENT,
    _access: { [CLIENT]: 1 },
    resourceType: 'Binary',
    id: uuid,
    contentType: 'application/pdf',
    meta: { versionId: '1', source: 'synthetic', lastUpdated: new Date().toISOString() }
});

const summarize = (explain) => {
    const stats = explain.executionStats;
    const stages = [];
    const indexNames = [];
    const walk = (node) => {
        if (!node) return;
        stages.push(node.stage);
        if (node.indexName) indexNames.push(node.indexName);
        (node.inputStages || (node.inputStage ? [node.inputStage] : [])).forEach(walk);
        if (node.queryPlan) walk(node.queryPlan);
    };
    walk(explain.queryPlanner.winningPlan.queryPlan || explain.queryPlanner.winningPlan);
    return {
        plan: [...new Set(stages)].join('>'),
        indexes: [...new Set(indexNames)].join(','),
        keys: stats.totalKeysExamined,
        docs: stats.totalDocsExamined,
        returned: stats.nReturned,
        ms: stats.executionTimeMillis
    };
};

describe('Binary person-securityContext filter explain (opt-in)', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    test('explain before/after the securityContext indexes', async () => {
        await createTestRequest();
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const collection = db.collection(COLLECTION);

        // seed: UNOWNED Binary without securityContext (like the existing ones) + owned ones
        const docs = [];
        for (let i = 0; i < UNOWNED; i++) docs.push(baseDoc(randomUUID()));
        const persons = [];
        for (let i = 0; i < PERSONS; i++) {
            const person = randomUUID();
            persons.push(person);
            const ref = `Patient/person.${person}`;
            docs.push({ ...baseDoc(randomUUID()), securityContext: { reference: ref, _uuid: ref, _sourceId: ref, _sourceAssigningAuthority: CLIENT } });
        }
        const realPatients = [];
        for (let i = 0; i < REAL_PATIENTS; i++) {
            const patient = randomUUID();
            realPatients.push(patient);
            const ref = `Patient/${patient}`;
            docs.push({ ...baseDoc(randomUUID()), securityContext: { reference: ref, _uuid: ref, _sourceId: `Patient/${patient}`, _sourceAssigningAuthority: CLIENT } });
        }
        for (let i = 0; i < docs.length; i += 10000) await collection.insertMany(docs.slice(i, i + 10000));
        const byIdUuid = docs[0]._uuid;

        // generic indexes (what Binary_4_0_0 gets without this change), then drop the two new ones for "before"
        const indexManager = container.indexManager;
        await indexManager.indexCollectionAsync({ collectionName: COLLECTION, db });
        const { indexes: toCreate } = await indexManager.getIndexesToCreateForCollectionAsync({ collectionName: COLLECTION });
        const newConfigs = toCreate.filter(i => i.options.name.startsWith('securityContext'));
        expect(newConfigs.map(i => i.options.name).sort()).toEqual(['securityContextSourceId_uuid', 'securityContextUuid_uuid']);
        for (const c of newConfigs) await collection.dropIndex(c.options.name);
        // prod has per-client access-tag indexes (ACCESS_TAGS_INDEXED); model one for the mixed shape
        await collection.createIndex({ '_access.client1': 1, _uuid: 1 }, { name: '_access_client1_1._uuid_1' });

        const patientIds = [`person.${persons[0]}`, realPatients[0], randomUUID()]; // proxy + linked real patient + other linked
        const q = container.patientQueryCreator;
        const shapes = {
            'pure patient token (strict)': q.getQueryWithPersonSecurityContext({ patientIds, query: {}, resourceType: 'Binary', useHistoryTable: false, strict: true }),
            'mixed token, tenant filter only': q.getQueryWithPersonSecurityContext({ patientIds, query: { '_access.client1': 1 }, resourceType: 'Binary', useHistoryTable: false, strict: false }),
            'mixed token, by id': q.getQueryWithPersonSecurityContext({ patientIds, query: { _uuid: byIdUuid }, resourceType: 'Binary', useHistoryTable: false, strict: false })
        };

        const rows = [];
        const run = async (stage) => {
            for (const [name, query] of Object.entries(shapes)) {
                const explain = await collection.find(query).explain('executionStats');
                rows.push({ stage, shape: name, ...summarize(explain) });
            }
        };
        await run('before');
        for (const c of newConfigs) await indexManager.createIndexIfNotExistsAsync({ db, indexConfig: c, collectionName: COLLECTION });
        await run('after');
        const stats = await collection.aggregate([{ $collStats: { storageStats: {} } }]).toArray();
        const idx = stats[0].storageStats.indexSizes;
        console.log(`docs=${docs.length} owned=${PERSONS + REAL_PATIENTS}\n` + JSON.stringify(shapes, null, 1) + '\n' +
            rows.map(r => JSON.stringify(r)).join('\n') + '\nindexSizes(bytes)=' + JSON.stringify(idx));
        const after = rows.filter(r => r.stage === 'after');
        expect(after[0].plan).toContain('IXSCAN');
    });
});
