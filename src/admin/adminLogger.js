class AdminLogger {
    async logTrace(message) {
        console.log(message);
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
