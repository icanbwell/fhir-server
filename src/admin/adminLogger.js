class AdminLogger {
    async logTrace(message) {
        console.trace(message);
    }

    async log(message) {
        console.log(message);
    }

    async logError(message) {
        console.error(message);
    }
}

module.exports = {
    AdminLogger
};
