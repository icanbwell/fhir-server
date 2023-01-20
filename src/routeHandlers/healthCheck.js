/**
 * This route handler implements the /health endpoint which returns the health of the system
 */

const env = require('var');
const {Kafka} = require('kafkajs');
const {RethrownError} = require('../utils/rethrownError');

let kafkaClientFactory;
let kafkaClient;
let producer;

module.exports.handleHealthCheck = async (fnCreateContainer, req, res) => {
    if (env.ENABLE_EVENTS_KAFKA === '1') {
        const container = fnCreateContainer();
        /**
         * @type {kafkaClientFactory}
         */
        kafkaClientFactory = kafkaClientFactory || container.kafkaClientFactory;
        kafkaClient = kafkaClient || new Kafka(await kafkaClientFactory.getKafkaClientConfigAsync());
        producer = producer || kafkaClient.producer();

        try {
            await producer.connect();
        } catch (e) {
            throw new RethrownError({
                message: 'Kafka health check failed',
                error: e,
            });
        } finally {
            await producer.disconnect();
        }
        return res.json({status: 'Kafka health check passed'});
    }
    return res.json({status: 'ok'});
};
