const { describe, test, beforeEach, afterEach, expect } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, getTestContainer, createTestRequest, getHeaders
} = require('../../common');

async function rawDocById(container, collectionName, id) {
    const db = await container.mongoDatabaseManager.getClientDbAsync();
    return db.collection(collectionName).findOne({ id });
}

function normalizeSecurity(security) {
    // Compare the practical content of each tag: system, code, and the real coding id.
    // The normal (class-based) flow persists empty fields as explicit null (id:null, display:null)
    // while the fast flow trims them; that storage nuance is pre-existing and semantically
    // equivalent, so we drop empty id/display before comparing and only assert on real values.
    return [...(security || [])]
        .map(s => {
            const tag = { system: s.system, code: s.code };
            if (s.id) tag.id = s.id;
            if (s.display) tag.display = s.display;
            return tag;
        })
        .sort((a, b) => (a.system + a.code).localeCompare(b.system + b.code));
}

/**
 * Runs the same $merge through one flow (fast or normal) and returns the persisted meta.security.
 * A fresh container is created per call so the merge operation picks the manager matching the env.
 */
async function mergeAndGetSecurity({ resourceType, collectionName, id, fast, build }) {
    process.env.ENABLE_MERGE_FAST_SERIALIZER = fast ? '1' : '0';
    const request = await createTestRequest();
    const container = getTestContainer();
    const resp = await request
        .post(`/4_0_0/${resourceType}/1/$merge`)
        .send(build(id))
        .set(getHeaders());
    expect(resp.status).toBe(200);
    const doc = await rawDocById(container, collectionName, id);
    expect(doc).not.toBeNull();
    return normalizeSecurity(doc.meta.security);
}

async function assertParity({ resourceType, collectionName, codingIdResources, build }) {
    const savedFast = process.env.ENABLE_MERGE_FAST_SERIALIZER;
    const savedCoding = process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES;
    process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES = codingIdResources;
    try {
        const fastSecurity = await mergeAndGetSecurity({ resourceType, collectionName, id: 'fast1', fast: true, build });
        const normalSecurity = await mergeAndGetSecurity({ resourceType, collectionName, id: 'normal1', fast: false, build });
        // console.log(`[${resourceType}] fast  :`, JSON.stringify(fastSecurity));
        // console.log(`[${resourceType}] normal:`, JSON.stringify(normalSecurity));
        expect(fastSecurity).toEqual(normalSecurity);
        return fastSecurity;
    } finally {
        process.env.ENABLE_MERGE_FAST_SERIALIZER = savedFast;
        if (savedCoding === undefined) delete process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES;
        else process.env.PRE_SAVE_CODING_ID_UPDATE_RESOURCES = savedCoding;
    }
}

describe('Fast vs normal merge meta.security parity', () => {
    beforeEach(async () => { await commonBeforeEach(); });
    afterEach(async () => { await commonAfterEach(); });

    // owner + access provided; SAA is auto-added by SourceAssigningAuthorityColumnHandler,
    // which is exactly the path that used to stamp an id only in the fast flow.
    const buildPatient = (id) => ({
        resourceType: 'Patient', id, name: [{ family: 'X' }],
        meta: { source: 'http://e.com', security: [
            { system: 'https://www.icanbwell.com/access', code: 'bwell' },
            { system: 'https://www.icanbwell.com/owner', code: 'bwell' }
        ] }
    });
    const buildObservation = (id) => ({
        resourceType: 'Observation', id, status: 'final', code: { text: 'x' },
        meta: { source: 'http://e.com', security: [
            { system: 'https://www.icanbwell.com/access', code: 'bwell' },
            { system: 'https://www.icanbwell.com/owner', code: 'bwell' }
        ] }
    });

    test('Patient (not a coding-id type): no coding ids in either flow', async () => {
        const security = await assertParity({
            resourceType: 'Patient', collectionName: 'Patient_4_0_0',
            codingIdResources: 'Binary,Observation', build: buildPatient
        });
        // none of the tags should carry an id for a non-coding-id resource
        expect(security.every(s => s.id === undefined || s.id === null)).toBe(true);
    });

    test('Observation (a coding-id type): coding ids present in both flows', async () => {
        const security = await assertParity({
            resourceType: 'Observation', collectionName: 'Observation_4_0_0',
            codingIdResources: 'Binary,Observation', build: buildObservation
        });
        // every tag (including the auto-added SAA) should carry an id for a coding-id resource
        expect(security.every(s => !!s.id)).toBe(true);
    });

    // Regression: the auto-added SAA coding id must NOT depend on the validator's write-serialize
    // timing. With UPDATE_MERGE_VALIDATIONS=false the validator serializes the incoming BEFORE the
    // SAA tag is auto-added, so the id is now stamped by the column handler itself (gated only by
    // PRE_SAVE_CODING_ID_UPDATE_RESOURCES), keeping fast and normal identical regardless of the flag.
    test('Observation auto-added SAA gets an id even with UPDATE_MERGE_VALIDATIONS=false', async () => {
        const savedUmv = process.env.UPDATE_MERGE_VALIDATIONS;
        process.env.UPDATE_MERGE_VALIDATIONS = 'false';
        try {
            const security = await assertParity({
                resourceType: 'Observation', collectionName: 'Observation_4_0_0',
                codingIdResources: 'Binary,Observation', build: buildObservation
            });
            const saa = security.find(s => s.system.endsWith('/sourceAssigningAuthority'));
            expect(saa).toBeDefined();
            expect(saa.id).toBeTruthy();
        } finally {
            if (savedUmv === undefined) delete process.env.UPDATE_MERGE_VALIDATIONS;
            else process.env.UPDATE_MERGE_VALIDATIONS = savedUmv;
        }
    });
});
