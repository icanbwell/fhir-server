/**
 * This route handler implements the /health endpoint which returns the health of the system
 */

const {handleKafkaHealthCheck} = require('../utils/kafkaHealthCheck');
const {handleLogHealthCheck} = require('../utils/logHealthCheck');
const {handleHealthCheckQuery} = require('../utils/mongoDBHealthCheck');

let container;

// Does a health check for the app
module.exports.handleHealthCheck = async (fnCreateContainer, req, res) => {
    let status = {};
    // check kafka connection
    try {
        if ( await handleKafkaHealthCheck(fnCreateContainer)) {
            status.kafkaStatus = 'OK';
        } else {
            status.kafkaStatus = 'Failed';
        }
    } catch (e){
        // kafka health check failed
        status.kafkaStatus = 'Failed';
    }
    // check logging
    try {
        if (await handleLogHealthCheck()) {
            status.logStatus = 'OK';
        } else {
            status.logStatus = 'Failed';
        }
    } catch (e) {
        status.logStatus = 'Failed';
    }
    // check mongoDB
    try {
        container = container || fnCreateContainer();
        const databaseQueryFactory = container.databaseQueryFactory;
        if (await handleHealthCheckQuery(databaseQueryFactory)) {
            status.mongoDBStatus = 'OK';
        } else {
            status.mongoDBStatus = 'Failed';
        }
    } catch (e) {
        status.mongoDBStatus = 'Failed';
    }
    return res.json({status});
};
