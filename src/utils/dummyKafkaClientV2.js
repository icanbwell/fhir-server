const { KafkaClientV2 } = require('./kafkaClientV2');

class DummyKafkaClientV2 extends KafkaClientV2 {
    init({ clientId, brokers, ssl, sasl }) {
        // no-op when v2 Kafka is disabled
    }

    async sendCloudEventMessageAsync({ topic, messages }) {
        // no-op when v2 Kafka is disabled
    }

    async createConsumerAsync({ groupId }) {
        // no-op when v2 Kafka is disabled
        return null;
    }

    async receiveMessagesAsync({ consumer, topic, fromBeginning, onMessageAsync }) {
        // no-op when v2 Kafka is disabled
    }

    waitForConsumerToJoinGroupAsync(consumer, opts) {
        return Promise.resolve();
    }

    async removeConsumerAsync({ consumer }) {
        // no-op when v2 Kafka is disabled
    }

    createAdminClient() {
        // no-op when v2 Kafka is disabled
        return null;
    }
}

module.exports = { DummyKafkaClientV2 };
