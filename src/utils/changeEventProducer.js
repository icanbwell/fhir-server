const {KafkaClient} = require('./KafkaClient');
const env = require('var');

class ChangeEventProducer {
    constructor() {
        this.kafkaClient = new KafkaClient();
    }

    /**
     * Fire event for patient change
     * @param {string} patientId
     * @param {date} timestamp
     * @return {Promise<void>}
     */
    async onPatientChangeAsync(patientId, timestamp) {
        if (!env.ENABLE_EVENTS_KAFKA) {
            return;
        }
        const topic = 'business.events';
        const messages = [
            {
                'resourceType': 'AuditEvent',
                'id': '01023320-5ac5-4309-8e53-2bd0f7e22ac9',
                'action': 'E',
                'period':
                    {
                        'start': timestamp,
                        'end': timestamp
                    },
                'purposeOfEvent':
                    [
                        {
                            'coding':
                                [
                                    {
                                        'system': 'https://www.icanbwell.com/event-purpose',
                                        'code': 'Patient Change'
                                    }
                                ]
                        }
                    ],
                'agent':
                    [
                        {
                            'who':
                                {
                                    'reference': `Patient/${patientId}`
                                }
                        }
                    ]
            }
        ];

        await this.kafkaClient.sendMessageAsync(topic, messages);
    }
}

module.exports = {
    ChangeEventProducer
};
