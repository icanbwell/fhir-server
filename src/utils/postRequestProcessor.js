/**
 * This class stores any actions to run after the current request has finished
 * The goal is to get the response back to client quickly and then run these actions
 */
const {logErrorToSlackAsync} = require('./slack.logger');

class PostRequestProcessor {
    constructor() {
        /**
         * queue
         * @type {(function():void)[]}
         */
        this.queue = [];
    }

    /**
     * Add a task to the queue
     * @type {(function():void)[]}
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
}

module.exports = {
    PostRequestProcessor
};

