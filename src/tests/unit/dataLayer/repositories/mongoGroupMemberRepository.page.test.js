const { describe, test, expect, jest } = require('@jest/globals');
const { MongoGroupMemberRepository } = require('../../../../dataLayer/repositories/mongoGroupMemberRepository');

describe('MongoGroupMemberRepository.getMemberPageAsync', () => {
    test('asks Mongo for one sorted, skipped and limited page of the Group roster', async () => {
        const rows = [
            { _uuid: 'a', member: { entity: { reference: 'Patient/1' } } },
            { _uuid: 'b', member: { entity: { reference: 'Patient/2' } } }
        ];
        const findAsync = jest.fn().mockResolvedValue({ toArrayAsync: async () => rows });
        const createQuery = jest.fn().mockReturnValue({ findAsync });
        const repository = Object.create(MongoGroupMemberRepository.prototype);
        repository.databaseQueryFactory = { createQuery };

        const page = await repository.getMemberPageAsync({
            base_version: '4_0_0',
            groupUuid: 'g-uuid',
            offset: 40,
            count: 2
        });

        expect(createQuery).toHaveBeenCalledWith({ resourceType: 'GroupMember', base_version: '4_0_0' });
        expect(findAsync).toHaveBeenCalledWith({
            query: { groupUuid: 'g-uuid' },
            options: {
                projection: { member: 1, _uuid: 1, _id: 0 },
                sort: { _uuid: 1 },
                skip: 40,
                limit: 2
            }
        });
        expect(page.members).toEqual([
            { entity: { reference: 'Patient/1' } },
            { entity: { reference: 'Patient/2' } }
        ]);
        expect(page.queryItem).toEqual({ query: { groupUuid: 'g-uuid' }, collectionName: 'GroupMember_4_0_0' });
    });

    test('applies maxTimeMS to the page read when given, and not otherwise', async () => {
        const toArrayAsync = jest.fn().mockResolvedValue([]);
        const cursor = { toArrayAsync, maxTimeMS: jest.fn() };
        cursor.maxTimeMS.mockReturnValue(cursor);
        const findAsync = jest.fn().mockResolvedValue(cursor);
        const repository = Object.create(MongoGroupMemberRepository.prototype);
        repository.databaseQueryFactory = { createQuery: () => ({ findAsync }) };
        const params = { base_version: '4_0_0', groupUuid: 'g-uuid', offset: 4900000, count: 1 };

        await repository.getMemberPageAsync({ ...params, maxTimeMS: 120000 });
        expect(cursor.maxTimeMS).toHaveBeenCalledWith({ milliSecs: 120000 });

        cursor.maxTimeMS.mockClear();
        await repository.getMemberPageAsync(params);
        expect(cursor.maxTimeMS).not.toHaveBeenCalled();
    });
});
