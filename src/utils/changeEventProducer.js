const env = require('var');
const {generateUUID} = require('./uid.util');
const moment = require('moment-timezone');
const {assertTypeEquals} = require('./assertType');
const {KafkaClient} = require('./kafkaClient');
const {ResourceManager} = require('../operations/common/resourceManager');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * This class is used to produce change events
 */
class ChangeEventProducer {
    /**
     * Constructor
     * @param {KafkaClient} kafkaClient
     * @param {ResourceManager} resourceManager
     */
    constructor(kafkaClient, resourceManager) {
        assertTypeEquals(kafkaClient, KafkaClient);
        assertTypeEquals(resourceManager, ResourceManager);
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        /**
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        /**
         * @type {Map<string, Object>}
         */
        this.messageMap = new Map();
    }

    /**
     * Fire event for patient create
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
     * Fires events when a resource is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update
     * @param {string} resourceType
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async fireEventsAsync(requestId, eventType, resourceType, doc) {
        /**
         * @type {string|null}
         */
        const patientId = await this.resourceManager.getPatientIdFromResourceAsync(resourceType, doc);
        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');
        if (eventType === 'C' && resourceType === 'Patient') {
            await this.onPatientCreateAsync(requestId, patientId, currentDate);
        } else {
            await this.onPatientChangeAsync(requestId, patientId, currentDate);
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

        await mutex.runExclusive(async () => {
            /**
             * @type {{requestId: *, fhirVersion: string, value: string, key: *}[]}
             */
            const messages = Array.from(
                this.messageMap.entries(),
                ([/** @type {string} */ patientId, /** @type {Object} */ messageJson]) => {
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
        });
    }
}

module.exports = {
    ChangeEventProducer
};
