'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { handleHealthCheckQuery } = require('../../../utils/mongoDBHealthCheck');

describe('mongoDBHealthCheck', () => {
    test('returns true when findOneAsync succeeds', async () => {
        const container = {
            databaseQueryFactory: {
                createQuery: jestObj.fn().mockReturnValue({
                    findOneAsync: jestObj.fn().mockResolvedValue({ id: 'p1' })
                })
            }
        };
        const result = await handleHealthCheckQuery(container);
        expect(result).toBe(true);
    });

    test('returns false when findOneAsync throws', async () => {
        const container = {
            databaseQueryFactory: {
                createQuery: jestObj.fn().mockReturnValue({
                    findOneAsync: jestObj.fn().mockRejectedValue(new Error('connection refused'))
                })
            }
        };
        const result = await handleHealthCheckQuery(container);
        expect(result).toBe(false);
    });

    test('queries Patient resource type', async () => {
        const createQuery = jestObj.fn().mockReturnValue({
            findOneAsync: jestObj.fn().mockResolvedValue(null)
        });
        const container = { databaseQueryFactory: { createQuery } };
        await handleHealthCheckQuery(container);
        expect(createQuery).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: 'Patient' })
        );
    });

    test('returns true even when findOneAsync returns null', async () => {
        const container = {
            databaseQueryFactory: {
                createQuery: jestObj.fn().mockReturnValue({
                    findOneAsync: jestObj.fn().mockResolvedValue(null)
                })
            }
        };
        const result = await handleHealthCheckQuery(container);
        expect(result).toBe(true);
    });
});
