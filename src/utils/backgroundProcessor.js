let backgroundInstance;

class BackgroundProcessor {
    constructor() {
        /**
         * queue
         * @type {(function():void)[]}
         */
        this.queue = [];
        this.delay = 1000;
        this.timer = setTimeout(
            this.tick,
            this.delay
        );
    }

    stop() {
        if (!this.timer) {
            return;
        }
        clearTimeout(this.timer);
        this.timer = null;
    }

    /**
     * @return {BackgroundProcessor}
     */
    static getInstance() {
        if (!backgroundInstance) {
            backgroundInstance = new BackgroundProcessor();
        }
        return backgroundInstance;
    }

    add(fnTask) {
        this.queue.push(fnTask);
    }

    /**
     * Runs the next task in the queue
     */
    tick() {
        const task = this.queue.pop();
        task();
    }
}

module.exports = {
    BackgroundProcessor
};
