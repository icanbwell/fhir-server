'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { handleHealthCheckQuery } = require('../../../utils/mongoDBHealthCheck');

const queryManagerReturning = (docs) => ({
    findAsync: jestObj.fn().mockResolvedValue({ toArrayAsync: jestObj.fn().mockResolvedValue(docs) })
});

describe('mongoDBHealthCheck', () => {
    test.each([
        ['a document is returned', [{ id: 'p1' }]],
        ['no document is returned', []]
    ])('returns true when the query succeeds and %s', async (_name, docs) => {
        const container = {
            databaseQueryFactory: { createQuery: jestObj.fn().mockReturnValue(queryManagerReturning(docs)) }
        };
        const result = await handleHealthCheckQuery(container);
        expect(result).toBe(true);
    });

    test('returns false when the query throws', async () => {
        const container = {
            databaseQueryFactory: {
                createQuery: jestObj.fn().mockReturnValue({
                    findAsync: jestObj.fn().mockRejectedValue(new Error('connection refused'))
                })
            }
        };
        const result = await handleHealthCheckQuery(container);
        expect(result).toBe(false);
    });

    test('returns false when reading the cursor throws', async () => {
        const container = {
            databaseQueryFactory: {
                createQuery: jestObj.fn().mockReturnValue({
                    findAsync: jestObj.fn().mockResolvedValue({
                        toArrayAsync: jestObj.fn().mockRejectedValue(new Error('cursor closed'))
                    })
                })
            }
        };
        const result = await handleHealthCheckQuery(container);
        expect(result).toBe(false);
    });

    test('queries a single Patient document', async () => {
        const manager = queryManagerReturning([]);
        const createQuery = jestObj.fn().mockReturnValue(manager);
        const container = { databaseQueryFactory: { createQuery } };
        await handleHealthCheckQuery(container);
        expect(createQuery).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: 'Patient' })
        );
        expect(manager.findAsync).toHaveBeenCalledWith({ query: {}, options: { limit: 1 } });
    });
});
