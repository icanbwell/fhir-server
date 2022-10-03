const moment = require('moment-timezone');

class AdminLogger {
    async logTrace(message) {
        if (message === '\n') {
            console.log(message);
        } else {
            console.log(`[${moment().toISOString()}] ` + message);
        }
    }

    async log(message) {
        if (message === '\n') {
            console.log(message);
        } else {
            console.log(`[${moment().toISOString()}] ` + message);
        }
    }

    async logError(message) {
        console.error(`[${moment().toISOString()}] ` + message);
    }
}

module.exports = {
    AdminLogger
};
