const {KafkaClient} = require('./KafkaClient');
const env = require('var');
const {generateUUID} = require('./uid.util');

class ChangeEventProducer {
    constructor() {
        this.kafkaClient = new KafkaClient();
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onPatientCreateAsync(requestId, patientId, timestamp) {
        if (!env.ENABLE_EVENTS_KAFKA) {
            return;
        }
        const fhirVersion = 'R4';
        const topic = 'business.events';
        const messageJson = {
            'resourceType': 'AuditEvent',
            'id': generateUUID(),
            'action': 'C',
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
        };

        await this.kafkaClient.sendMessagesAsync(topic, [
            {
                key: patientId,
                fhirVersion: fhirVersion,
                requestId: requestId,
                value: JSON.stringify(messageJson)
            }
        ]);
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onPatientChangeAsync(requestId, patientId, timestamp) {
        if (!env.ENABLE_EVENTS_KAFKA) {
            return;
        }
        const fhirVersion = 'R4';
        const topic = 'business.events';
        const messageJson = {
            'resourceType': 'AuditEvent',
            'id': generateUUID(),
            'action': 'U',
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
        };

        await this.kafkaClient.sendMessagesAsync(topic, [
            {
                key: patientId,
                fhirVersion: fhirVersion,
                requestId: requestId,
                value: JSON.stringify(messageJson)
            }
        ]);
    }
}

module.exports = {
    ChangeEventProducer
};
