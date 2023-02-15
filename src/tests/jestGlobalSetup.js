// globalSetup.js
const {startTestMongoServerAsync} = require('./mongoTestRunner');
module.exports = async () => {
        await startTestMongoServerAsync();
};
