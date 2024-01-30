const { getLogger } = require('../winstonInit');

class AdminLogger {
    constructor() {
        const parentLogger = getLogger();
        this.logger = parentLogger.child();
        this.logger.defaultMeta = { ...parentLogger.defaultMeta, logger: 'admin' };
    }

    logInfo(message, args) {
        this.logger.info(message, args);
    }

    logError(message, args) {
        this.logger.error(message, args);
    }
}

module.exports = {
    AdminLogger
};
