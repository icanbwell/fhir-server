/**
 * This utiilty does a health check on the Kafka connection
 */

const env = require('var');
const { isTrue } = require('../utils/isTrue');
const { KAFKA_CONNECTION_HEALTHCHECK_INTERVAL } = require('../constants');

let kafkaClient;
let timeTillKafkaReconnection;
let producer;

// Does a health check for the app
module.exports.handleKafkaHealthCheck = async (container) => {
    let healthy = true;
    // If events is to be logged on kafka, check kafka connection
    if (isTrue(env.ENABLE_EVENTS_KAFKA) && isTrue(env.ENABLE_KAFKA_HEALTHCHECK)) {
        // Check Kafka connection at an interval of 30 seconds
        if (timeTillKafkaReconnection === undefined || timeTillKafkaReconnection < new Date()) {
            kafkaClient = kafkaClient || container.kafkaClient;
            // Initiates a producer
            producer = producer || kafkaClient.producer;

            try {
                // Initiates a connection between the producer and the broker.
                if (!kafkaClient.producerConnected) {
                    await producer.connect();
                    kafkaClient.producerConnected = true;
                }
                // Calculates the time after which kafka is to be reconnected.
                timeTillKafkaReconnection = new Date(new Date().getTime() + KAFKA_CONNECTION_HEALTHCHECK_INTERVAL);
                return true;
            } catch (e) {
                healthy = false;
            }
        }
    }
    return healthy;
};
