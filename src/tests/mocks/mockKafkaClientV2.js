const { KafkaClientV2 } = require('../../utils/kafkaClientV2');

class MockKafkaClientV2 extends KafkaClientV2 {
    constructor({ configManager }) {
        super({ configManager });
        this.cloudEventMessages = [];
    }

    init({ clientId, brokers, ssl, sasl }) {
        // do nothing
    }

    async sendCloudEventMessageAsync({ topic, messages }) {
        this.cloudEventMessages = this.cloudEventMessages.concat(messages);
    }

    getCloudEventMessages() {
        return this.cloudEventMessages;
    }

    clear() {
        this.cloudEventMessages = [];
    }
}

module.exports = { MockKafkaClientV2 };
