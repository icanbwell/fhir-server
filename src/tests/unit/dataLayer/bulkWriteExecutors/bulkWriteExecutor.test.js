'use strict';

const { describe, test, expect } = require('@jest/globals');

const { BulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/bulkWriteExecutor');

describe('BulkWriteExecutor', () => {
    let executor;

    test('canHandle throws "must override" error', () => {
        executor = new BulkWriteExecutor();
        expect(() => executor.canHandle('Patient')).toThrow('must override');
    });

    test('executeBulkAsync throws "must override" error', async () => {
        executor = new BulkWriteExecutor();
        await expect(executor.executeBulkAsync({
            resourceType: 'Patient',
            operations: [],
            requestInfo: {},
            base_version: '4_0_0',
            useHistoryCollection: false,
            maintainOrder: false,
            isAccessLogOperation: false,
            insertOneHistoryFn: () => {}
        })).rejects.toThrow('must override');
    });

    test('can be instantiated without arguments', () => {
        executor = new BulkWriteExecutor();
        expect(executor).toBeInstanceOf(BulkWriteExecutor);
    });

    test('canHandle receives resourceType parameter', () => {
        executor = new BulkWriteExecutor();
        try {
            executor.canHandle('Observation');
        } catch (e) {
            expect(e.message).toBe('must override');
        }
    });

    test('executeBulkAsync receives all expected parameters', async () => {
        executor = new BulkWriteExecutor();
        const params = {
            resourceType: 'Observation',
            operations: [{ id: '1' }],
            requestInfo: { requestId: 'req-1' },
            base_version: '4_0_0',
            useHistoryCollection: true,
            maintainOrder: true,
            isAccessLogOperation: false,
            insertOneHistoryFn: () => {}
        };
        try {
            await executor.executeBulkAsync(params);
        } catch (e) {
            expect(e.message).toBe('must override');
        }
    });

    test('subclass can override canHandle', () => {
        class TestExecutor extends BulkWriteExecutor {
            canHandle(resourceType) {
                return resourceType === 'Patient';
            }
        }
        const testExecutor = new TestExecutor();
        expect(testExecutor.canHandle('Patient')).toBe(true);
        expect(testExecutor.canHandle('Observation')).toBe(false);
    });

    test('subclass can override executeBulkAsync', async () => {
        class TestExecutor extends BulkWriteExecutor {
            async executeBulkAsync({ resourceType }) {
                return { resourceType, success: true };
            }
        }
        const testExecutor = new TestExecutor();
        const result = await testExecutor.executeBulkAsync({ resourceType: 'Patient' });
        expect(result).toEqual({ resourceType: 'Patient', success: true });
    });
});
