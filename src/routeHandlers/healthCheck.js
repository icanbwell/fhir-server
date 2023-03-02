/**
 * This route handler implements the /health endpoint which returns the health of the system
 */

const env = require('var');
const { isTrue } = require('../utils/isTrue');
const {Kafka} = require('kafkajs');
const {RethrownError} = require('../utils/rethrownError');
const {KAFKA_CONNECTION_HEALTHCHECK_INTERVAL} = require('../constants');

let kafkaClientFactory;
let kafkaClient;
let timeTillKafkaReconnection;
let producer;
let container;
/**
 * @type {{sasl: {accessKeyId: (string|null), secretAccessKey: (string|null), authorizationIdentity: (string|undefined), password: (string|null), mechanism: (string|undefined), username: (string|null)}, clientId: (string|undefined), brokers: string[], ssl: boolean}}
 */
let config;

// Does a health check for the app
module.exports.handleHealthCheck = async (fnCreateContainer, req, res) => {
    // If events is to be logged on kafka, check kafka connection
    if (isTrue(env.ENABLE_EVENTS_KAFKA) && isTrue(env.ENABLE_KAFKA_HEALTHCHECK)) {
        // Check Kafka connection at an interval of 30 seconds
        if (timeTillKafkaReconnection === undefined || timeTillKafkaReconnection < new Date()) {
            // Either creates a container and stores in a variable for subsequent calls
            container = container || fnCreateContainer();
            /**
             * @type {kafkaClientFactory}
             */
            kafkaClientFactory = kafkaClientFactory || container.kafkaClientFactory;
            if (!config) {
                config = await kafkaClientFactory.getKafkaClientConfigAsync();
            }
            kafkaClient = kafkaClient || new Kafka(config);
            // Initiates a producer
            producer = producer || kafkaClient.producer();

            try {
                // Initiates a connection between the producer and the broker.
                await producer.connect();
                // Calculates the time after which kafka is to be reconnected.
                timeTillKafkaReconnection = new Date(new Date().getTime() + KAFKA_CONNECTION_HEALTHCHECK_INTERVAL);
                return res.json({status: 'ok'});
            } catch (e) {
                throw new RethrownError({
                    message: 'Kafka health check failed',
                    error: e,
                });
            } finally {
                // Disconnects the connection between broker and producer
                producer.disconnect();
            }
        }
        return res.json({status: 'ok'});
    }
    return res.json({status: 'ok'});
};
