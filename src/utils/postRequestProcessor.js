/**
 * This class stores any actions to run after the current request has finished
 * The goal is to get the response back to client quickly and then run these actions
 */
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { logSystemErrorAsync, logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');
const { RequestSpecificCache } = require('./requestSpecificCache');

/**
 * This class implements a processor that runs tasks after the response for the current request has been
 * sent to the client.  This speeds up responding to clients and offloading other tasks for after
 */
class PostRequestProcessor {
    /**
     * Constructor
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor ({ requestSpecificCache }) {
        /**
         * @type {Map<string,boolean>}
         */
        this.executionRunningForRequestIdMap = new Map();
        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * Gets the queue
     * @param {string} requestId
     * @return {(() =>void)[]}
     */
    getQueue ({ requestId }) {
        assertIsValid(requestId, 'requestId is null');
        return this.requestSpecificCache.getList({ requestId, name: 'PostRequestProcessorQueue' });
    }

    /**
     * Add a task to the queue
     * @param {string} requestId
     * @param {() =>void} fnTask
     */
    add ({ requestId, fnTask }) {
        assertIsValid(requestId, 'requestId is null');
        this.getQueue({ requestId }).push(fnTask);
    }

    /**
     * @param {string} requestId
     * @return {boolean}
     */
    executionRunningForRequest ({ requestId }) {
        return this.executionRunningForRequestIdMap.get(requestId) || false;
    }

    /**
     * @param {string} requestId
     * @param {boolean} value
     */
    setExecutionRunningForRequest ({ requestId, value }) {
        if (value) {
            this.executionRunningForRequestIdMap.set(requestId, true);
        } else {
            this.executionRunningForRequestIdMap.delete(requestId);
        }
    }

    /**
     * Run all the tasks
     * @param {string} requestId
     * @return {Promise<void>}
     */
    async executeAsync ({ requestId }) {
        assertIsValid(requestId, 'requestId is null');
        const queue = this.getQueue({ requestId });
        if (this.executionRunningForRequest({ requestId }) || queue.length === 0) {
            return;
        }
        const tasksInQueueBefore = queue.length;

        this.setExecutionRunningForRequest({ requestId, value: true });
        await logTraceSystemEventAsync(
            {
                event: 'executeAsync',
                message: `executeAsync: ${requestId}`,
                args: {
                    requestId,
                    count: queue.length
                }
            }
        );
        /**
         * @type {function(): Promise<void>}
         */
        let task = queue.shift();
        while (task !== undefined) {
            try {
                await task();
            } catch (e) {
                await logSystemErrorAsync(
                    {
                        event: 'postRequestProcessor',
                        message: 'Error running task',
                        args: {
                            requestId
                        },
                        error: e
                    }
                );
                // swallow the error so we can continue processing
            }
            task = queue.shift();
        }
        this.setExecutionRunningForRequest({ requestId, value: false });
        // If we processed any tasks then log it
        if (tasksInQueueBefore > 0) {
            await logTraceSystemEventAsync(
                {
                    event: 'postRequestProcessor',
                    message: 'Finished',
                    args: {
                        tasksInQueueBefore,
                        tasksInQueueAfter: queue.length,
                        requestId
                    }
                }
            );
        }
    }

    /**
     * Waits until the queue is empty
     * @param {string} requestId
     * @param {number|null|undefined} [timeoutInSeconds]
     * @return {Promise<boolean>}
     */
    async waitTillDoneAsync ({ requestId, timeoutInSeconds }) {
        assertIsValid(requestId, 'requestId is null');
        const queue = this.getQueue({ requestId });
        await logTraceSystemEventAsync(
            {
                event: 'waitTillDoneAsync',
                message: `waitTillDoneAsync: ${requestId}`,
                args: {
                    requestId,
                    count: queue.length
                }
            }
        );
        if (queue.length === 0) {
            return true;
        }
        assertIsValid(this.executionRunningForRequest({ requestId }) || queue.length === 0, `executeAsync is not running so queue will never empty for requestId: ${requestId}`);
        let secondsWaiting = 0;
        while (queue.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            secondsWaiting += 1;
            if (timeoutInSeconds && secondsWaiting > timeoutInSeconds) {
                await this.requestSpecificCache.clearAsync({ requestId });
                throw new Error(`PostRequestProcessor.waitTillDoneAsync() for ${requestId} did not finish in specified time: ${timeoutInSeconds}`);
            }
        }
        return true;
    }

    /**
     * Waits till all requests are done
     * @param {number|null|undefined} [timeoutInSeconds]
     * @return {Promise<void>}
     */
    async waitTillAllRequestsDoneAsync ({ timeoutInSeconds }) {
        const requestIds = this.requestSpecificCache.getRequestIds();
        for (const requestId of requestIds) {
            await this.waitTillDoneAsync({ requestId, timeoutInSeconds });
        }
    }
}

module.exports = {
    PostRequestProcessor
};
