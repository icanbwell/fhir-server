/**
 * This class stores any actions to run after the current request has finished
 * The goal is to get the response back to client quickly and then run these actions
 */
const {ErrorReporter} = require('./slack.logger');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {logSystemEventAsync, logSystemErrorAsync} = require('../operations/common/logging');

/**
 * This class implements a processor that runs tasks after the response for the current request has been
 * sent to the client.  This speeds up responding to clients and offloading other tasks for after
 */
class PostRequestProcessor {
    /**
     * Constructor
     * @param {ErrorReporter} errorReporter
     */
    constructor({errorReporter}) {
        assertTypeEquals(errorReporter, ErrorReporter);
        /**
         * queue
         * @type {(() =>void)[]}
         */
        this.queue = [];
        /**
         * @type {ErrorReporter}
         */
        this.errorReporter = errorReporter;
        /**
         * @type {boolean}
         */
        this.startedExecuting = false;
    }

    /**
     * Add a task to the queue
     * @param {() =>void} fnTask
     */
    add(fnTask) {
        this.queue.push(fnTask);
    }

    /**
     * Run all the tasks
     * @return {Promise<void>}
     */
    async executeAsync() {
        if (this.startedExecuting) {
            return;
        }
        this.startedExecuting = true;
        const tasksInQueue = this.queue.length;
        /**
         * @type {function(): void}
         */
        let task = this.queue.shift();
        while (task !== undefined) {
            try {
                await task();
            } catch (e) {
                await this.errorReporter.reportErrorAsync('Error running post request task', e);
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
            task = this.queue.shift();
        }
        this.startedExecuting = false;
        if (tasksInQueue > 0) {
            await logSystemEventAsync(
                {
                    event: 'postRequestProcessor',
                    message: 'Finished',
                    args: {
                        tasksInQueueBefore: tasksInQueue,
                        tasksInQueueAfter: this.queue.length
                    }
                }
            );
        }
    }

    /**
     * Waits until the queue is empty
     * @param {number|null|undefined} [timeoutInSeconds]
     * @return {Promise<boolean>}
     */
    async waitTillDoneAsync(timeoutInSeconds) {
        if (this.queue.length === 0) {
            return true;
        }
        assertIsValid(this.startedExecuting || this.queue.length === 0, 'executeAsync is not running so queue will never empty');
        let secondsWaiting = 0;
        while (this.queue.length > 0) {
            await new Promise((r) => setTimeout(r, 1000));
            secondsWaiting += 1;
            if (timeoutInSeconds && secondsWaiting > timeoutInSeconds) {
                throw new Error(`PostRequestProcessor.waitTillDoneAsync() did not finish in specified time: ${timeoutInSeconds}`);
            }
        }
        return true;
    }
}

module.exports = {
    PostRequestProcessor
};

