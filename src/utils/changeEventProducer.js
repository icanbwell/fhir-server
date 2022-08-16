const {KafkaClient} = require('./KafkaClient');
const env = require('var');
const {generateUUID} = require('./uid.util');

class ChangeEventProducer {
    constructor() {
        this.kafkaClient = new KafkaClient();
        /**
         * @type {Map<string, Object>}
         */
        this.messageMap = new Map();
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onPatientCreateAsync(requestId, patientId, timestamp) {
        const isCreate = true;

        const messageJson = this._createMessage(patientId, timestamp, isCreate);
        this.messageMap.set(patientId, messageJson);
    }

    /**
     * Creates a message
     * @param {string} patientId
     * @param {string} timestamp
     * @param {boolean} isCreate
     * @return {{period: {start, end}, agent: [{who: {reference: string}}], action: (string), id: string, purposeOfEvent: [{coding: [{system: string, code: string}]}], resourceType: string}}
     * @private
     */
    _createMessage(patientId, timestamp, isCreate) {
        return {
            'resourceType': 'AuditEvent',
            'id': generateUUID(),
            'action': isCreate ? 'C' : 'U',
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
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onPatientChangeAsync(requestId, patientId, timestamp) {
        const isCreate = false;

        const messageJson = this._createMessage(patientId, timestamp, isCreate);

        const existingMessageEntry = this.messageMap.get(patientId);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.messageMap.set(patientId, messageJson);
        }
    }

    /**
     * flushes the change event buffer
     * @param requestId
     * @return {Promise<void>}
     */
    async flushAsync(requestId) {
        if (!env.ENABLE_EVENTS_KAFKA) {
            this.messageMap.clear();
            return;
        }
        if (this.messageMap.size === 0) {
            return;
        }

        // find unique events
        const fhirVersion = 'R4';
        const topic = 'business.events';

        /**
         * @type {{requestId: *, fhirVersion: string, value: string, key: *}[]}
         */
        const messages = Array.from(this.messageMap.entries(), ([patientId, messageJson]) => {
                return {
                    key: patientId,
                    fhirVersion: fhirVersion,
                    requestId: requestId,
                    value: JSON.stringify(messageJson)
                };
            }
        );

        await this.kafkaClient.sendMessagesAsync(topic, messages);

        this.messageMap.clear();
    }
}

module.exports = {
    ChangeEventProducer
};
