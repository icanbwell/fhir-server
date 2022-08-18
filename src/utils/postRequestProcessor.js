/**
 * This class stores any actions to run after the current request has finished
 * The goal is to get the response back to client quickly and then run these actions
 */
const {logErrorToSlackAsync} = require('./slack.logger');

/**
 * This class implements a processor that runs tasks after the response for the current request has been
 * sent to the client.  This speeds up responding to clients and offloading other tasks for after
 */
class PostRequestProcessor {
    /**
     * Constructor
     */
    constructor() {
        /**
         * queue
         * @type {(() =>void)[]}
         */
        this.queue = [];
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
        /**
         * @type {function(): void}
         */
        let task = this.queue.pop();
        while (task !== undefined) {
            try {
                await task();
            } catch (e) {
                await logErrorToSlackAsync('Error running post request task', e);
            }
            task = this.queue.pop();
        }
    }

    /**
     * Waits until the queue is empty
     * @return {Promise<boolean>}
     */
    async waitTillDone() {
        while (this.queue.length > 0) {
            await new Promise((r) => setTimeout(r, 1000));
        }
        return true;
    }
}

module.exports = {
    PostRequestProcessor
};

