const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/fhirErrorFactory', () => ({
    createTooCostlyError: jestObj.fn()
}));

const { GroupInvariantHandler } = require('../../../preSaveHandlers/handlers/groupInvariantHandler');
const { BadRequestError } = require('../../../utils/httpErrors');

describe('GroupInvariantHandler', () => {
    let handler;
    let mockConfigManager;

    beforeEach(() => {
        mockConfigManager = {
            groupMemberLimit: 100
        };

        handler = new GroupInvariantHandler({ configManager: mockConfigManager });
    });

    describe('constructor', () => {
        test('stores configManager', () => {
            expect(handler.configManager).toBe(mockConfigManager);
        });
    });

    describe('preSaveAsync', () => {
        test('returns resource unchanged for non-Group resources', async () => {
            const resource = { resourceType: 'Patient', id: '123' };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource unchanged for Group with actual=true and members', async () => {
            const resource = {
                resourceType: 'Group',
                actual: true,
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource unchanged for Group with actual=true and no members', async () => {
            const resource = {
                resourceType: 'Group',
                actual: true
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource unchanged for Group with actual=false and no members', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false,
                member: []
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource unchanged for Group with actual=false and undefined member', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('throws error with statusCode 400 for Group with actual=false and members (grp-1 invariant)', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false,
                member: [
                    { entity: { reference: 'Patient/1' } },
                    { entity: { reference: 'Patient/2' } }
                ]
            };

            await expect(handler.preSaveAsync({ resource })).rejects.toMatchObject({
                statusCode: 400
            });
        });

        test('throws error with correct message for grp-1 violation', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false,
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            await expect(handler.preSaveAsync({ resource })).rejects.toThrow(
                /FHIR invariant grp-1 violated/
            );
        });

        test('throws error when actual is undefined and has members', async () => {
            const resource = {
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            await expect(handler.preSaveAsync({ resource })).rejects.toMatchObject({
                statusCode: 400
            });
        });

        test('throws error when actual is null and has members', async () => {
            const resource = {
                resourceType: 'Group',
                actual: null,
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            await expect(handler.preSaveAsync({ resource })).rejects.toMatchObject({
                statusCode: 400
            });
        });

        test('returns resource unchanged for Group with actual=false and empty member array', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false,
                member: []
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource unchanged for Group with actual=false and member is not an array', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false,
                member: 'not-an-array'
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource unchanged for various non-Group resource types', async () => {
            const resourceTypes = ['Patient', 'Observation', 'Encounter', 'Condition', 'Procedure'];

            for (const resourceType of resourceTypes) {
                const resource = { resourceType, id: '1', actual: false, member: [{ entity: {} }] };
                const result = await handler.preSaveAsync({ resource });
                expect(result).toBe(resource);
            }
        });

        test('throws error with statusCode 400 for grp-1 violation (BadRequestError)', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false,
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            try {
                await handler.preSaveAsync({ resource });
                expect(true).toBe(false); // should not reach
            } catch (e) {
                expect(e.statusCode).toBe(400);
                expect(e.message).toContain('grp-1');
            }
        });

        test('error message includes invariant name grp-1', async () => {
            const resource = {
                resourceType: 'Group',
                actual: false,
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            try {
                await handler.preSaveAsync({ resource });
                // Should not reach here
                expect(true).toBe(false);
            } catch (e) {
                expect(e.message).toContain('grp-1');
                expect(e.message).toContain('actual = true');
            }
        });

        test('returns resource for Group with actual=true and many members', async () => {
            const members = Array.from({ length: 200 }, (_, i) => ({
                entity: { reference: `Patient/${i}` }
            }));
            const resource = {
                resourceType: 'Group',
                actual: true,
                member: members
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('returns resource for Group with actual=true and empty member array', async () => {
            const resource = {
                resourceType: 'Group',
                actual: true,
                member: []
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('throws when actual is 0 (falsy) and has members', async () => {
            const resource = {
                resourceType: 'Group',
                actual: 0,
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            await expect(handler.preSaveAsync({ resource })).rejects.toMatchObject({
                statusCode: 400
            });
        });
    });
});
