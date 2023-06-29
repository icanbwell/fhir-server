/**
 * This route handler implements the /health endpoint which returns the health of the system
 */

const {handleKafkaHealthCheck} = require('../utils/kafkaHealthCheck');
const {handleLogHealthCheck} = require('../utils/logHealthCheck');

let container;

// Does a health check for the app
module.exports.handleHealthCheck = async (fnCreateContainer, req, res) => {
    let status = {};
    // check kafka connection
    let kafkaOK = false;
    try {
        kafkaOK = await handleKafkaHealthCheck(fnCreateContainer);
        if (kafkaOK) {
            status.kafkaStatus = 'OK';
        } else {
            status.kafkaStatus = 'Failed';
        }
    } catch (e){
        // kafka health check failed
        status.kafkaStatus = 'Failed';
    }
    // check logging
    let logOK = false;
    try {
        logOK = await handleLogHealthCheck();
        if (logOK) {
            status.logStatus = 'OK';
        } else {
            status.logStatus = 'Failed';
        }
    } catch (e) {
        status.logStatus = 'Failed';
    }
    let mongoOK = false;
    try {
        container = container || fnCreateContainer();
        /**
         * @type {MongoDBHealthCheck}
         */
        const mongoDBHealthCheck = container.mongoDBHealthCheck;
        mongoOK = await mongoDBHealthCheck.healthCheckQuery();
        if (mongoOK) {
            status.mongoDBStatus = 'OK';
        } else {
            status.mongoDBStatus = 'Failed';
        }
    } catch (e) {
        status.mongoDBStatus = 'Failed';
    }
    return res.json({status});
};
