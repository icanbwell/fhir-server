/**
 * This route handler implements the /full-healthcheck endpoint which returns the health of the system
 */

const { handleKafkaHealthCheck } = require('../utils/kafkaHealthCheck');
const { handleLogHealthCheck } = require('../utils/logHealthCheck');
const { handleHealthCheckQuery } = require('../utils/mongoDBHealthCheck');

let container;

// Does a health check for the app
module.exports.handleFullHealthCheck = async (fnGetContainer, req, res) => {
    const status = {};
    container = container || fnGetContainer();

    // check kafka connection
    try {
        const results = await Promise.allSettled([
            handleKafkaHealthCheck(container),
            handleLogHealthCheck(),
            handleHealthCheckQuery(container),
            container.redisClient.checkConnectionHealth()
        ]);
        if (!Array.isArray(results) || results.length !== 4) {
            status.kafkaStatus = 'Failed';
            status.logStatus = 'Failed';
            status.mongoDBStatus = 'Failed';
            status.redisStatus = 'Failed';
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
            if (results[3]) {
                status.redisStatus = 'OK';
            } else {
                status.redisStatus = 'Failed';
            }
        }
    } catch (e) {
        status.kafkaStatus = 'Failed';
        status.logStatus = 'Failed';
        status.mongoDBStatus = 'Failed';
        status.redisStatus = 'Failed';
    }
    return res.json({ status });
};
