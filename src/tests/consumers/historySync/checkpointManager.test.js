const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { CheckpointManager } = require('../../../consumers/historySync/checkpointManager');
const { generateUUIDv5 } = require('../../../utils/uid.util');

describe('CheckpointManager', () => {
    let checkpointManager;
    let mockMergeOperation;
    let mockSearchByIdOperation;
    let mockR4ArgsParser;

    beforeEach(async () => {
        await commonBeforeEach();

        mockSearchByIdOperation = {
            searchByIdAsync: jest.fn(async () => null)
        };

        mockMergeOperation = {
            mergeAsync: async () => [{ created: true, id: 'test-id' }]
        };

        mockR4ArgsParser = {
            parseArgs: ({ resourceType, args }) => ({
                resourceType,
                base_version: args.base_version,
                id: args.id
            })
        };

        checkpointManager = new CheckpointManager({
            mergeOperation: mockMergeOperation,
            searchByIdOperation: mockSearchByIdOperation,
            r4ArgsParser: mockR4ArgsParser
        });
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('getTaskId', () => {
        test('should generate deterministic UUID for resource type', () => {
            const id1 = checkpointManager.getTaskId('Patient');
            const id2 = checkpointManager.getTaskId('Patient');
            expect(id1).toBe(id2);
            expect(id1).toBe(generateUUIDv5('Patient|fhirHistorySync'));
        });

        test('should generate different IDs for different resource types', () => {
            const patientId = checkpointManager.getTaskId('Patient');
            const personId = checkpointManager.getTaskId('Person');
            expect(patientId).not.toBe(personId);
        });
    });

    describe('getCheckpointAsync', () => {
        test('should return null when no checkpoint exists', async () => {
            const result = await checkpointManager.getCheckpointAsync('Patient');
            expect(result).toBeNull();
            expect(mockSearchByIdOperation.searchByIdAsync).toHaveBeenCalledTimes(1);
            expect(mockSearchByIdOperation.searchByIdAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Task' })
            );
        });

        test('should return null when searchById throws 404', async () => {
            mockSearchByIdOperation.searchByIdAsync = jest.fn(async () => {
                const error = new Error('Resource not found');
                error.statusCode = 404;
                throw error;
            });

            const result = await checkpointManager.getCheckpointAsync('Patient');
            expect(result).toBeNull();
        });

        test('should return checkpoint data when Task exists', async () => {
            mockSearchByIdOperation.searchByIdAsync = jest.fn(async () => ({
                resourceType: 'Task',
                id: checkpointManager.getTaskId('Patient'),
                input: [
                    { id: 'lastMongoId', type: { text: 'lastMongoId' }, valueString: '682d833de0f8c1253ef59c48' },
                    { id: 'lastUpdated', type: { text: 'lastUpdated' }, valueString: '2025-05-21T07:39:41.822Z' }
                ]
            }));

            const result = await checkpointManager.getCheckpointAsync('Patient');

            expect(result).not.toBeNull();
            expect(result.lastMongoId).toBe('682d833de0f8c1253ef59c48');
            expect(result.lastUpdated).toBe('2025-05-21T07:39:41.822Z');
        });

        test('should return null when Task exists but has no lastMongoId', async () => {
            mockSearchByIdOperation.searchByIdAsync = jest.fn(async () => ({
                resourceType: 'Task',
                id: checkpointManager.getTaskId('Patient'),
                input: []
            }));

            const result = await checkpointManager.getCheckpointAsync('Patient');
            expect(result).toBeNull();
        });
    });

    describe('updateCheckpointAsync', () => {
        test('should call mergeAsync with correct Task structure', async () => {
            let capturedArgs;
            mockMergeOperation.mergeAsync = async (args) => {
                capturedArgs = args;
                return [{ created: true, id: 'test-id' }];
            };

            await checkpointManager.updateCheckpointAsync(
                'Patient',
                '682d833de0f8c1253ef59c48',
                '2025-05-21T07:39:41.822Z'
            );

            expect(capturedArgs).toBeDefined();
            expect(capturedArgs.resourceType).toBe('Task');

            const body = capturedArgs.requestInfo.body;
            expect(body).toHaveLength(1);

            const task = body[0];
            expect(task.resourceType).toBe('Task');
            expect(task.id).toBe(generateUUIDv5('Patient|fhirHistorySync'));
            expect(task.status).toBe('in-progress');
            expect(task.intent).toBe('order');
            expect(task.meta.source).toBe('https://www.icanbwell.com/fhir-history-sync-consumer');
            expect(task.code.coding[0].code).toBe('fhirHistorySync');
            expect(task.code.coding[1]).toEqual({ system: 'https://www.icanbwell.com/resource-type', code: 'Patient' });

            const lastMongoIdInput = task.input.find(i => i.id === 'lastMongoId');
            expect(lastMongoIdInput.valueString).toBe('682d833de0f8c1253ef59c48');

            const lastUpdatedInput = task.input.find(i => i.id === 'lastUpdated');
            expect(lastUpdatedInput.valueString).toBe('2025-05-21T07:39:41.822Z');
        });

        test('should throw when merge returns operationOutcome', async () => {
            mockMergeOperation.mergeAsync = async () => [{
                operationOutcome: {
                    issue: [{ diagnostics: 'Merge validation failed' }]
                }
            }];

            await expect(
                checkpointManager.updateCheckpointAsync('Patient', 'some-id', '2025-01-01T00:00:00Z')
            ).rejects.toThrow('Checkpoint merge failed for Patient');
        });
    });

    describe('completeCheckpointAsync', () => {
        test('should merge Task with status completed', async () => {
            let capturedArgs;
            mockMergeOperation.mergeAsync = async (args) => {
                capturedArgs = args;
                return [{ updated: true, id: 'test-id' }];
            };

            await checkpointManager.completeCheckpointAsync('Patient');

            expect(capturedArgs).toBeDefined();
            const task = capturedArgs.requestInfo.body[0];
            expect(task.status).toBe('completed');
            expect(task.id).toBe(generateUUIDv5('Patient|fhirHistorySync'));
        });

        test('should throw when merge returns operationOutcome', async () => {
            mockMergeOperation.mergeAsync = async () => [{
                operationOutcome: {
                    issue: [{ diagnostics: 'Complete failed' }]
                }
            }];

            await expect(
                checkpointManager.completeCheckpointAsync('Patient')
            ).rejects.toThrow('Checkpoint complete failed for Patient');
        });
    });
});
