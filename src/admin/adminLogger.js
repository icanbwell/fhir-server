const moment = require('moment-timezone');

class AdminLogger {
    async logTrace(message) {
        console.log(`[${moment().toISOString()}] ` + message);
    }

    async log(message) {
        console.log(`[${moment().toISOString()}] ` + message);
    }

    async logError(message) {
        console.error(`[${moment().toISOString()}] ` + message);
    }
}

module.exports = {
    AdminLogger
};
