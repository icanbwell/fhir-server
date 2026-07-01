const { describe, test, beforeAll, beforeEach, afterEach, afterAll, expect, jest } = require('@jest/globals');
const {
    setupGroupTests,
    teardownGroupTests,
    cleanupAllData,
    getSharedRequest,
    getClickHouseManager,
    getTestHeadersWithExternalStorage
} = require('./groupTestSetup');
const { GroupMemberRepository } = require('../../dataLayer/repositories/groupMemberRepository');

/**
 * Group dual-write split-brain on ClickHouse write failure.
 *
 * For a Group create/PUT/$merge with the useExternalStorage header, MongoDB is committed first
 * with member[] stripped, then the member events are written to ClickHouse in the synchronous
 * post-save handler. If that ClickHouse write fails, the previous behavior left MongoDB holding
 * a committed Group with NO members and ClickHouse holding NO events: a silently-empty
 * (orphaned) Group, with no compensation.
 *
 * These tests inject a ClickHouse write failure (by making the member repository's appendEvents
 * throw) and assert a CONSISTENT outcome:
 *   1. The API operation fails (non-2xx) so the client knows the write did not fully succeed, AND
 *   2. The members the client submitted are NOT silently lost. The compensation restores the
 *      original member[] back onto the committed MongoDB document.
 *
 * i.e. never a silently-empty Group.
 */
describe('Group ClickHouse write-failure consistency', () => {
    let appendEventsSpy;

    beforeAll(async () => {
        await setupGroupTests();
    });

    beforeEach(async () => {
        await cleanupAllData();
    });

    afterEach(() => {
        if (appendEventsSpy) {
            appendEventsSpy.mockRestore();
            appendEventsSpy = null;
        }
    });

    afterAll(async () => {
        await teardownGroupTests();
    });

    const defaultMeta = {
        source: 'http://test-system.com/Group',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
            { system: 'https://www.icanbwell.com/access', code: 'test-access' }
        ]
    };

    /**
     * Forces every ClickHouse member-event write to fail, simulating a ClickHouse outage /
     * network partition during the post-save handler. The handler is constructed fresh per
     * request via the factory, so spying on the prototype reliably intercepts the write.
     */
    function injectClickHouseWriteFailure() {
        appendEventsSpy = jest
            .spyOn(GroupMemberRepository.prototype, 'appendEvents')
            .mockRejectedValue(new Error('Simulated ClickHouse outage'));
    }

    /**
     * Reads the raw stored MongoDB Group document directly by FHIR id (bypassing the read API,
     * which would route member queries to ClickHouse). Lets us inspect exactly what was persisted.
     *
     * Uses the live, bootstrapped test container's mongoDatabaseManager to get the fhir DB — a
     * fresh createTestContainer() is not connected (its mongoClient is undefined), so this is the
     * correct handle for the running server's Mongo.
     */
    async function readRawMongoGroupById(id) {
        const { getTestContainer } = require('../common');
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection('Group_4_0_0').findOne({ id });
    }

    async function postGroup(group) {
        const request = getSharedRequest();
        return request
            .post('/4_0_0/Group')
            .send({ resourceType: 'Group', ...group, meta: group.meta || defaultMeta })
            .set(getTestHeadersWithExternalStorage());
    }

    /**
     * Reads every stored Group document from MongoDB. Because each test starts from a clean
     * collection (cleanupAllData) and does a single create, this lets us assert the invariant
     * without depending on the resource id — a POST /Group assigns a server-generated UUID as
     * `id` (and `_sourceId`), so the client-supplied `id` in the body is NOT the stored id.
     */
    async function readAllRawMongoGroups() {
        const { getTestContainer } = require('../common');
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return db.collection('Group_4_0_0').find({}).toArray();
    }

    test('CREATE: ClickHouse write failure does not leave a silently-empty Group in MongoDB', async () => {
        const clickHouseManager = getClickHouseManager();
        const submittedMembers = [
            { entity: { reference: 'Patient/ea2322-a' } },
            { entity: { reference: 'Patient/ea2322-b' } },
            { entity: { reference: 'Patient/ea2322-c' } }
        ];

        injectClickHouseWriteFailure();

        const response = await postGroup({
            type: 'person',
            actual: true,
            member: submittedMembers
        });

        // 1. The operation must NOT report success: the ClickHouse half of the dual write failed.
        expect(response.status).toBeGreaterThanOrEqual(400);

        // Confirm the failure was the injected ClickHouse error, not something incidental.
        expect(appendEventsSpy).toHaveBeenCalled();

        // 2. The committed MongoDB document must NOT be a silently-empty Group. Compensation
        //    restores the original members onto the Mongo document so no data is lost. We assert
        //    on the single stored Group (id is server-assigned on POST, so we do not filter by it).
        const stored = await readAllRawMongoGroups();
        expect(stored).toHaveLength(1);
        expect(Array.isArray(stored[0].member)).toBe(true);
        expect(stored[0].member).toHaveLength(submittedMembers.length);
        const storedRefs = stored[0].member.map(m => m.entity.reference).sort();
        expect(storedRefs).toEqual(submittedMembers.map(m => m.entity.reference).sort());

        // 3. ClickHouse must have no events for the created group (the write failed). The group
        //    id is the server-assigned _uuid on the stored document.
        const events = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '${stored[0]._uuid}'`
        });
        expect(parseInt(events[0].count)).toBe(0);
    });

    test('PUT/UPDATE: ClickHouse write failure preserves submitted members in MongoDB', async () => {
        const clickHouseManager = getClickHouseManager();
        const request = getSharedRequest();

        // First create succeeds (no failure injected yet). POST assigns a server-generated id,
        // so we PUT/read by the id the server actually returned, not a client-chosen string.
        const createResponse = await postGroup({
            type: 'person',
            actual: true,
            member: [{ entity: { reference: 'Patient/ea2322-initial' } }]
        });
        expect(createResponse.status).toBe(201);
        const createdId = createResponse.body.id;
        expect(createdId).toBeTruthy();

        // Now inject failure and PUT a new membership.
        injectClickHouseWriteFailure();

        const putMembers = [
            { entity: { reference: 'Patient/ea2322-put-1' } },
            { entity: { reference: 'Patient/ea2322-put-2' } }
        ];

        const putResponse = await request
            .put(`/4_0_0/Group/${createdId}`)
            .send({
                resourceType: 'Group',
                id: createdId,
                type: 'person',
                actual: true,
                meta: defaultMeta,
                member: putMembers
            })
            .set(getTestHeadersWithExternalStorage());

        // Operation must fail (ClickHouse half failed).
        expect(putResponse.status).toBeGreaterThanOrEqual(400);
        expect(appendEventsSpy).toHaveBeenCalled();

        // The committed Mongo document must retain the submitted PUT members (no silent loss),
        // and must NOT be a silently-empty Group. PUT preserves the id, so we can read by it.
        const stored = await readRawMongoGroupById(createdId);

        expect(stored).toBeTruthy();
        expect(Array.isArray(stored.member)).toBe(true);
        expect(stored.member.length).toBeGreaterThan(0);
        const storedRefs = stored.member.map(m => m.entity.reference).sort();
        expect(storedRefs).toEqual(putMembers.map(m => m.entity.reference).sort());

        // ClickHouse holds NO events for the PUT members (the PUT's ClickHouse write failed).
        // Note: the earlier successful CREATE legitimately wrote an event for Patient/ea2322-initial,
        // so we assert specifically that NONE of the PUT-submitted members produced events, rather
        // than that the whole group has zero events.
        const putRefs = putMembers.map(m => m.entity.reference);
        const putEvents = await clickHouseManager.queryAsync({
            query: `SELECT count() as count FROM fhir.Group_4_0_0_MemberEvents
                    WHERE group_id = '${stored._uuid}'
                      AND entity_reference IN (${putRefs.map(r => `'${r}'`).join(', ')})`
        });
        expect(parseInt(putEvents[0].count)).toBe(0);
    });

    test('CREATE with no members: ClickHouse failure is irrelevant (empty Group is consistent)', async () => {
        // With no submitted members there is nothing to write to ClickHouse, so the post-save
        // handler short-circuits before appendEvents. The create should succeed and the Group is
        // legitimately empty (not a split-brain).
        injectClickHouseWriteFailure();

        const response = await postGroup({
            type: 'person',
            actual: true,
            name: 'empty group'
        });

        expect(response.status).toBe(201);
        expect(appendEventsSpy).not.toHaveBeenCalled();
    });
});
