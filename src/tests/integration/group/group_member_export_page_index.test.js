const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../common');
const { GROUP_MEMBER_COLLECTION_NAME } = require('../../../constants');

describe('GroupMember_4_0_0 export page index', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        // getTestContainer() is only populated once the test app has been created
        await createTestRequest();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('page query is an IXSCAN on groupUuid_1__uuid_1 with no in-memory SORT', async () => {
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const collection = db.collection(GROUP_MEMBER_COLLECTION_NAME);

        // A few hundred rows across three Groups, so the planner has real selectivity to weigh:
        // the wildcard `_uuid` index alone would also satisfy the sort, but not the groupUuid filter.
        const rows = [];
        for (const groupUuid of ['g1', 'g2', 'g3']) {
            for (let i = 0; i < 100; i++) {
                const uuid = `${groupUuid}-${String(i).padStart(3, '0')}`;
                rows.push({
                    id: uuid,
                    _uuid: uuid,
                    groupUuid,
                    member: { entity: { reference: `Patient/${uuid}` } }
                });
            }
        }
        await collection.insertMany(rows);

        await container.indexManager.indexCollectionAsync({
            collectionName: GROUP_MEMBER_COLLECTION_NAME,
            db
        });

        const plan = await collection
            .find({
                groupUuid: 'g1',
                'member.entity.reference': { $regex: /^Patient\// },
                _uuid: { $gt: 'g1-010' }
            })
            .sort({ _uuid: 1 })
            .limit(20)
            .explain('queryPlanner');

        const winning = JSON.stringify(plan.queryPlanner.winningPlan);
        expect(winning).toContain('groupUuid_1__uuid_1');
        expect(winning).not.toContain('"stage":"SORT"');
    });
});
