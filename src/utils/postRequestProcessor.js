/**
 * This class stores any actions to run after the current request has finished
 * The goal is to get the response back to client quickly and then run these actions
 */
const {ErrorReporter} = require('./slack.logger');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {logSystemEventAsync, logSystemErrorAsync} = require('../operations/common/logging');
const {RequestSpecificCache} = require('./requestSpecificCache');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * This class implements a processor that runs tasks after the response for the current request has been
 * sent to the client.  This speeds up responding to clients and offloading other tasks for after
 */
class PostRequestProcessor {
    /**
     * Constructor
     * @param {ErrorReporter} errorReporter
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor({errorReporter, requestSpecificCache}) {
        assertTypeEquals(errorReporter, ErrorReporter);
        /**
         * @type {ErrorReporter}
         */
        this.errorReporter = errorReporter;
        /**
         * @type {boolean}
         */
        this.startedExecuting = false;
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
    getQueue({requestId}) {
        assertIsValid(requestId, 'requestId is null');
        return this.requestSpecificCache.getList({requestId, name: 'PostRequestProcessorQueue'});
    }

    /**
     * Add a task to the queue
     * @param {string} requestId
     * @param {() =>void} fnTask
     */
    add({requestId, fnTask}) {
        assertIsValid(requestId, 'requestId is null');
        this.getQueue({requestId}).push(fnTask);
    }

    /**
     * Run all the tasks
     * @param {string} requestId
     * @return {Promise<void>}
     */
    async executeAsync({requestId}) {
        assertIsValid(requestId, 'requestId is null');
        const queue = this.getQueue({requestId});
        if (this.startedExecuting || queue.length === 0) {
            return;
        }
        const tasksInQueueBefore = queue.length;

        await mutex.runExclusive(async () => {
            if (queue.length === 0) {
                return;
            }
            this.startedExecuting = true;
            /**
             * @type {function(): void}
             */
            let task = queue.shift();
            while (task !== undefined) {
                try {
                    await task();
                } catch (e) {
                    await this.errorReporter.reportErrorAsync({
                        source: 'PostRequestProcessor',
                        message: 'Error running post request task',
                        error: e
                    });
                    await logSystemErrorAsync(
                        {
                            event: 'postRequestProcessor',
                            message: 'Error running task',
                            args: {},
                            error: e
                        }
                    );
                    throw e;
                }
                task = queue.shift();
            }
            this.startedExecuting = false;
        });
        // If we processed any tasks then log it
        if (tasksInQueueBefore > 0) {
            await logSystemEventAsync(
                {
                    event: 'postRequestProcessor',
                    message: 'Finished',
                    args: {
                        tasksInQueueBefore: tasksInQueueBefore,
                        tasksInQueueAfter: queue.length
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
    async waitTillDoneAsync({requestId, timeoutInSeconds}) {
        assertIsValid(requestId, 'requestId is null');
        const queue = this.getQueue({requestId});
        await logSystemEventAsync(
            {
                event: 'waitTillDoneAsync',
                message: `waitTillDoneAsync: ${requestId}`,
                args: {
                    requestId: requestId,
                    count: queue.length
                }
            }
        );
        if (queue.length === 0) {
            return true;
        }
        assertIsValid(this.startedExecuting || queue.length === 0, 'executeAsync is not running so queue will never empty');
        let secondsWaiting = 0;
        while (queue.length > 0) {
            await new Promise((r) => setTimeout(r, 1000));
            secondsWaiting += 1;
            if (timeoutInSeconds && secondsWaiting > timeoutInSeconds) {
                throw new Error(`PostRequestProcessor.waitTillDoneAsync() did not finish in specified time: ${timeoutInSeconds}`);
            }
        }
        return true;
    }

    /**
     * Waits till all requests are done
     * @param {number|null|undefined} [timeoutInSeconds]
     * @return {Promise<void>}
     */
    async waitTillAllRequestsDoneAsync({timeoutInSeconds}) {
        const requestIds = this.requestSpecificCache.getRequestIds();
        for (const requestId of requestIds) {
            await this.waitTillDoneAsync({requestId, timeoutInSeconds});
        }
    }
}

module.exports = {
    PostRequestProcessor
};

