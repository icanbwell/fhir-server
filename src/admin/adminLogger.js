const { getLogger } = require('../winstonInit');

class AdminLogger {
    constructor() {
        this.logger = getLogger().child({ logger: 'admin' });
    }

    async logTrace(message, args) {
        this.logger.info(message, args);
    }

    async logError(message, args) {
        this.logger.error(message, args);
    }
}

module.exports = {
    AdminLogger
};
