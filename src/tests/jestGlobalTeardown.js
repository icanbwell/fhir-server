// globalTeardown.js
const {stopTestMongoServerAsync} = require('./mongoTestRunner');
module.exports = async () => {
    await stopTestMongoServerAsync();
};
