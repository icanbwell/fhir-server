/**
 * This route handler implements the /full-healthcheck endpoint which returns the health of the system
 */

const {handleKafkaHealthCheck} = require('../utils/kafkaHealthCheck');
const {handleLogHealthCheck} = require('../utils/logHealthCheck');
const {handleHealthCheckQuery} = require('../utils/mongoDBHealthCheck');

// Does a health check for the app
module.exports.handleFullHealthCheck = async (container, req, res) => {
    let status = {};

    // check kafka connection
    try {
        let results = await Promise.allSettled([
            handleKafkaHealthCheck(container),
            handleLogHealthCheck(),
            handleHealthCheckQuery(container)
        ]);
        if (!Array.isArray(results) || results.length !== 3) {
            status.kafkaStatus = 'Failed';
            status.logStatus = 'Failed';
            status.mongoDBStatus = 'Failed';
        } else {
            if (results[0]) {
                status.kafkaStatus = 'OK';
            } else {
                status.kafkaStatus = 'Failed';
            }
            if (results[1]) {
                status.logStatus = 'OK';
            } else {
                status.logStatus = 'Failed';
            }
            if (results[2]) {
                status.mongoDBStatus = 'OK';
            } else {
                status.mongoDBStatus = 'Failed';
            }
        }
    } catch (e) {
        status.kafkaStatus = 'Failed';
        status.logStatus = 'Failed';
        status.mongoDBStatus = 'Failed';
    }
    return res.json({status});
};
