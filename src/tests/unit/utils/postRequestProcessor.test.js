'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

/**
 * CACHE ANALYSIS for PostRequestProcessor:
 *
 * 1. Cache mechanism: RequestSpecificCache.getList() returns an array keyed by requestId + name ('PostRequestProcessorQueue')
 * 2. Cache KEY dimensions: (requestId, 'PostRequestProcessorQueue') -> function[]
 * 3. Method PARAMETERS:
 *    - add: { requestId, fnTask }
 *    - executeAsync: { requestId }
 *    - waitTillDoneAsync: { requestId, timeoutInSeconds }
 *    - getQueue: { requestId }
 * 4. Params NOT in key: fnTask itself is pushed into the array but the queue is shared per requestId
 *    The queue is mutated in place (shift/push). All tasks for the same requestId share one queue.
 * 5. Cached VALUE: An array of function tasks (task queue)
 * 6. Downstream consumer: executeAsync reads from the queue and executes each task
 * 7. Required test: Add tasks with same requestId; verify they all execute. Add tasks with different
 *    requestIds; verify isolation. Test re-entrancy guard (executionRunningForRequestIdMap).
 * 8. Mock setup: Real RequestSpecificCache. Mock logTraceSystemEventAsync / logSystemErrorAsync.
 * 9. Assertion: After executeAsync, queue should be empty. Tasks executed in order.
 */

// Mock the systemEventLogging module to avoid logger setup issues
jestGlobal.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jestGlobal.fn().mockResolvedValue(undefined),
    logSystemErrorAsync: jestGlobal.fn().mockResolvedValue(undefined)
}));

describe('PostRequestProcessor', () => {
    let requestSpecificCache;
    let processor;

    beforeEach(() => {
        requestSpecificCache = new RequestSpecificCache();
        processor = new PostRequestProcessor({ requestSpecificCache });
    });

    describe('getQueue', () => {
        test('returns an array for a given requestId', () => {
            const queue = processor.getQueue({ requestId: 'req-1' });
            expect(Array.isArray(queue)).toBe(true);
        });

        test('returns same array reference for same requestId', () => {
            const q1 = processor.getQueue({ requestId: 'req-1' });
            const q2 = processor.getQueue({ requestId: 'req-1' });
            expect(q1).toBe(q2);
        });

        test('returns different arrays for different requestIds', () => {
            const q1 = processor.getQueue({ requestId: 'req-1' });
            const q2 = processor.getQueue({ requestId: 'req-2' });
            expect(q1).not.toBe(q2);
        });

        test('throws when requestId is null/undefined', () => {
            expect(() => processor.getQueue({ requestId: null })).toThrow();
            expect(() => processor.getQueue({ requestId: undefined })).toThrow();
        });
    });

    describe('add', () => {
        test('adds a task to the queue for given requestId', () => {
            const fn = jestGlobal.fn();
            processor.add({ requestId: 'req-1', fnTask: fn });

            const queue = processor.getQueue({ requestId: 'req-1' });
            expect(queue).toHaveLength(1);
            expect(queue[0]).toBe(fn);
        });

        test('adds multiple tasks to same requestId queue in order', () => {
            const fn1 = jestGlobal.fn();
            const fn2 = jestGlobal.fn();
            const fn3 = jestGlobal.fn();
            processor.add({ requestId: 'req-1', fnTask: fn1 });
            processor.add({ requestId: 'req-1', fnTask: fn2 });
            processor.add({ requestId: 'req-1', fnTask: fn3 });

            const queue = processor.getQueue({ requestId: 'req-1' });
            expect(queue).toHaveLength(3);
            expect(queue[0]).toBe(fn1);
            expect(queue[1]).toBe(fn2);
            expect(queue[2]).toBe(fn3);
        });

        test('tasks for different requestIds are isolated', () => {
            const fn1 = jestGlobal.fn();
            const fn2 = jestGlobal.fn();
            processor.add({ requestId: 'req-1', fnTask: fn1 });
            processor.add({ requestId: 'req-2', fnTask: fn2 });

            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(1);
            expect(processor.getQueue({ requestId: 'req-2' })).toHaveLength(1);
            expect(processor.getQueue({ requestId: 'req-1' })[0]).toBe(fn1);
            expect(processor.getQueue({ requestId: 'req-2' })[0]).toBe(fn2);
        });

        test('throws when requestId is falsy', () => {
            expect(() => processor.add({ requestId: '', fnTask: () => {} })).toThrow();
        });
    });

    describe('executionRunningForRequest / setExecutionRunningForRequest', () => {
        test('returns false initially', () => {
            expect(processor.executionRunningForRequest({ requestId: 'req-1' })).toBe(false);
        });

        test('returns true after setting to true', () => {
            processor.setExecutionRunningForRequest({ requestId: 'req-1', value: true });
            expect(processor.executionRunningForRequest({ requestId: 'req-1' })).toBe(true);
        });

        test('returns false after setting to false (deletes entry)', () => {
            processor.setExecutionRunningForRequest({ requestId: 'req-1', value: true });
            processor.setExecutionRunningForRequest({ requestId: 'req-1', value: false });
            expect(processor.executionRunningForRequest({ requestId: 'req-1' })).toBe(false);
        });

        test('different requestIds are independent', () => {
            processor.setExecutionRunningForRequest({ requestId: 'req-1', value: true });
            expect(processor.executionRunningForRequest({ requestId: 'req-2' })).toBe(false);
        });
    });

    describe('executeAsync', () => {
        test('does nothing when queue is empty (0 tasks)', async () => {
            await processor.executeAsync({ requestId: 'req-1' });
            // No error thrown, execution flag not set
            expect(processor.executionRunningForRequest({ requestId: 'req-1' })).toBe(false);
        });

        test('executes single task (1 task)', async () => {
            const fn = jestGlobal.fn().mockResolvedValue(undefined);
            processor.add({ requestId: 'req-1', fnTask: fn });

            await processor.executeAsync({ requestId: 'req-1' });

            expect(fn).toHaveBeenCalledTimes(1);
            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(0);
        });

        test('executes multiple tasks in order (>1 tasks)', async () => {
            const executionOrder = [];
            const fn1 = jestGlobal.fn().mockImplementation(async () => { executionOrder.push(1); });
            const fn2 = jestGlobal.fn().mockImplementation(async () => { executionOrder.push(2); });
            const fn3 = jestGlobal.fn().mockImplementation(async () => { executionOrder.push(3); });

            processor.add({ requestId: 'req-1', fnTask: fn1 });
            processor.add({ requestId: 'req-1', fnTask: fn2 });
            processor.add({ requestId: 'req-1', fnTask: fn3 });

            await processor.executeAsync({ requestId: 'req-1' });

            expect(executionOrder).toEqual([1, 2, 3]);
            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(0);
        });

        test('continues processing even if a task throws an error', async () => {
            const fn1 = jestGlobal.fn().mockRejectedValue(new Error('Task 1 failed'));
            const fn2 = jestGlobal.fn().mockResolvedValue(undefined);

            processor.add({ requestId: 'req-1', fnTask: fn1 });
            processor.add({ requestId: 'req-1', fnTask: fn2 });

            await processor.executeAsync({ requestId: 'req-1' });

            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).toHaveBeenCalledTimes(1);
            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(0);
        });

        test('sets executionRunning to false after completion', async () => {
            const fn = jestGlobal.fn().mockResolvedValue(undefined);
            processor.add({ requestId: 'req-1', fnTask: fn });

            await processor.executeAsync({ requestId: 'req-1' });

            expect(processor.executionRunningForRequest({ requestId: 'req-1' })).toBe(false);
        });

        test('does NOT execute if execution is already running for that requestId', async () => {
            const fn = jestGlobal.fn().mockResolvedValue(undefined);
            processor.add({ requestId: 'req-1', fnTask: fn });

            // Simulate execution already running
            processor.setExecutionRunningForRequest({ requestId: 'req-1', value: true });

            await processor.executeAsync({ requestId: 'req-1' });

            // Task should NOT have been executed due to re-entrancy guard
            expect(fn).not.toHaveBeenCalled();
            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(1);
        });

        test('queues for different requestIds execute independently', async () => {
            const fn1 = jestGlobal.fn().mockResolvedValue(undefined);
            const fn2 = jestGlobal.fn().mockResolvedValue(undefined);

            processor.add({ requestId: 'req-1', fnTask: fn1 });
            processor.add({ requestId: 'req-2', fnTask: fn2 });

            await processor.executeAsync({ requestId: 'req-1' });

            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).not.toHaveBeenCalled();
            expect(processor.getQueue({ requestId: 'req-2' })).toHaveLength(1);
        });

        /**
         * BUG TEST: Call executeAsync twice with same requestId but different tasks added between calls.
         * Since the queue is shared by reference, tasks added DURING execution of the first batch
         * will be consumed by the same executeAsync call (because of the while(task=queue.shift()) loop).
         */
        test('tasks added during execution are consumed in the same executeAsync call', async () => {
            const fn2 = jestGlobal.fn().mockResolvedValue(undefined);

            // First task adds a new task to the queue during execution
            const fn1 = jestGlobal.fn().mockImplementation(async () => {
                processor.add({ requestId: 'req-1', fnTask: fn2 });
            });

            processor.add({ requestId: 'req-1', fnTask: fn1 });

            await processor.executeAsync({ requestId: 'req-1' });

            // Both fn1 and fn2 should have been called since fn2 was added mid-execution
            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).toHaveBeenCalledTimes(1);
            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(0);
        });

        /**
         * KEY BEHAVIOR TEST: Calling executeAsync a second time after the first completes
         * with new tasks added. Since execution is no longer running, the second call should work.
         */
        test('second call with same requestId executes newly added tasks after first call completes', async () => {
            const fn1 = jestGlobal.fn().mockResolvedValue(undefined);
            processor.add({ requestId: 'req-1', fnTask: fn1 });

            await processor.executeAsync({ requestId: 'req-1' });
            expect(fn1).toHaveBeenCalledTimes(1);

            // Add new task after first execution completes
            const fn2 = jestGlobal.fn().mockResolvedValue(undefined);
            processor.add({ requestId: 'req-1', fnTask: fn2 });

            await processor.executeAsync({ requestId: 'req-1' });
            expect(fn2).toHaveBeenCalledTimes(1);
            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(0);
        });
    });

    describe('waitTillDoneAsync', () => {
        test('returns true immediately when queue is empty', async () => {
            const result = await processor.waitTillDoneAsync({ requestId: 'req-1' });
            expect(result).toBe(true);
        });

        test('triggers executeAsync if execution is not running and queue is non-empty', async () => {
            const fn = jestGlobal.fn().mockResolvedValue(undefined);
            processor.add({ requestId: 'req-1', fnTask: fn });

            const result = await processor.waitTillDoneAsync({ requestId: 'req-1' });

            expect(result).toBe(true);
            expect(fn).toHaveBeenCalledTimes(1);
            expect(processor.getQueue({ requestId: 'req-1' })).toHaveLength(0);
        });

        test('throws when timeout exceeded', async () => {
            // Add a task that takes forever (simulated by never resolving via a long delay)
            // But since we can't easily test truly hanging tasks synchronously,
            // we simulate with a task that re-adds itself
            let callCount = 0;
            const neverEndingTask = jestGlobal.fn().mockImplementation(async () => {
                callCount++;
                if (callCount < 5) {
                    processor.add({ requestId: 'req-1', fnTask: neverEndingTask });
                }
            });

            // Manually set execution as running and leave item in queue
            // to simulate a stalled queue scenario
            processor.add({ requestId: 'req-1', fnTask: async () => {
                // This task adds more items and won't complete within timeout
                await new Promise(resolve => setTimeout(resolve, 2000));
            }});
            processor.setExecutionRunningForRequest({ requestId: 'req-1', value: true });

            await expect(
                processor.waitTillDoneAsync({ requestId: 'req-1', timeoutInSeconds: 1 })
            ).rejects.toThrow('did not finish in specified time');
        }, 10000);
    });

    describe('waitTillAllRequestsDoneAsync', () => {
        test('completes when no requests exist', async () => {
            await processor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 5 });
            // No error means success
        });

        test('processes all pending requestIds', async () => {
            const fn1 = jestGlobal.fn().mockResolvedValue(undefined);
            const fn2 = jestGlobal.fn().mockResolvedValue(undefined);

            processor.add({ requestId: 'req-1', fnTask: fn1 });
            processor.add({ requestId: 'req-2', fnTask: fn2 });

            await processor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 5 });

            expect(fn1).toHaveBeenCalledTimes(1);
            expect(fn2).toHaveBeenCalledTimes(1);
        });
    });

    describe('cache isolation and non-key parameter tests', () => {
        /**
         * The "non-key param" for PostRequestProcessor is fnTask itself.
         * Each call to add() with the same requestId pushes to the same queue.
         * This is by design (not a bug) - tasks accumulate in the shared queue.
         */
        test('multiple adds with same requestId accumulate in shared queue', async () => {
            const results = [];
            const fn1 = async () => { results.push('taskA'); };
            const fn2 = async () => { results.push('taskB'); };

            processor.add({ requestId: 'req-1', fnTask: fn1 });
            processor.add({ requestId: 'req-1', fnTask: fn2 });

            await processor.executeAsync({ requestId: 'req-1' });

            expect(results).toEqual(['taskA', 'taskB']);
        });

        /**
         * BUG-HUNTING TEST: What happens if we call executeAsync twice concurrently
         * for the same requestId? The re-entrancy guard should prevent double execution.
         */
        test('concurrent executeAsync calls for same requestId - second call is blocked', async () => {
            const executionOrder = [];

            const slowTask = async () => {
                executionOrder.push('start-slow');
                await new Promise(resolve => setTimeout(resolve, 50));
                executionOrder.push('end-slow');
            };
            const fastTask = async () => {
                executionOrder.push('fast');
            };

            processor.add({ requestId: 'req-1', fnTask: slowTask });
            processor.add({ requestId: 'req-1', fnTask: fastTask });

            // Start first execution
            const exec1 = processor.executeAsync({ requestId: 'req-1' });
            // Try second execution immediately - should be blocked by re-entrancy guard
            const exec2 = processor.executeAsync({ requestId: 'req-1' });

            await Promise.all([exec1, exec2]);

            // Both tasks should have been executed by the first call
            // The second call should have done nothing (queue was empty or blocked)
            expect(executionOrder).toContain('start-slow');
            expect(executionOrder).toContain('end-slow');
            expect(executionOrder).toContain('fast');
        });
    });
});
