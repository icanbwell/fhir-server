const env = require('var');
const {generateUUID} = require('./uid.util');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {KafkaClient} = require('./kafkaClient');
const {ResourceManager} = require('../operations/common/resourceManager');
const {logSystemEventAsync} = require('../operations/common/logging');

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
     * @param {string} patientChangeTopic
     * @param {string} taskChangeTopic
     */
    constructor({
                    kafkaClient,
                    resourceManager,
                    patientChangeTopic,
                    taskChangeTopic
                }) {
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);
        /**
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        assertTypeEquals(resourceManager, ResourceManager);
        /**
         * @type {string}
         */
        this.patientChangeTopic = patientChangeTopic;
        assertIsValid(patientChangeTopic);
        /**
         * @type {string}
         */
        this.taskChangeTopic = taskChangeTopic;
        assertIsValid(taskChangeTopic);
        /**
         * id, resource
         * @type {Map<string, Object>}
         */
        this.patientMessageMap = new Map();
        /**
         * resourceType/id, resource
         * @type {Map<string, Object>}
         */
        this.taskMessageMap = new Map();
    }

    /**
     * Creates a message
     * @param {string} requestId
     * @param {string} id
     * @param {string} timestamp
     * @param {boolean} isCreate
     * @param {string} resourceType
     * @param {string} eventName
     * @return {{period: {start, end}, agent: [{who: {reference: string}}], action: (string), id: string, purposeOfEvent: [{coding: Coding[]}], resourceType: string}}
     * @private
     */
    _createMessage({
                       requestId,
                       id,
                       timestamp,
                       isCreate,
                       resourceType,
                       eventName
                   }
    ) {
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
                                    'code': eventName
                                }
                            ]
                    }
                ],
            'agent':
                [
                    {
                        'who':
                            {
                                'reference': `${resourceType}/${id}`
                            }
                    }
                ],
            'source': {
                'site': requestId
            }
        };
    }

    /**
     * Fire event for patient create
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onPatientCreateAsync({requestId, patientId, timestamp}) {
        const isCreate = true;

        const resourceType = 'Patient';
        const messageJson = this._createMessage({
            requestId,
            id: patientId,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Patient Create'
        });
        const key = `${patientId}`;
        this.patientMessageMap.set(key, messageJson);
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onPatientChangeAsync({requestId, patientId, timestamp}) {
        const isCreate = false;

        const resourceType = 'Patient';
        const messageJson = this._createMessage({
            requestId, id: patientId, timestamp, isCreate,
            resourceType: resourceType,
            eventName: 'Patient Change'
        });

        const key = `${patientId}`;
        const existingMessageEntry = this.patientMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.patientMessageMap.set(key, messageJson);
        }
    }

    /**
     * Fire event for patient create
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onTaskCreateAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = true;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Task Create'
        });
        const key = `${id}`;
        this.taskMessageMap.set(key, messageJson);
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onTaskChangeAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = false;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Task Change'
        });

        const key = `${id}`;
        const existingMessageEntry = this.patientMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.patientMessageMap.set(key, messageJson);
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
    async fireEventsAsync({requestId, eventType, resourceType, doc}) {
        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');
        /**
         * @type {string|null}
         */
        const patientId = await this.resourceManager.getPatientIdFromResourceAsync(resourceType, doc);
        if (patientId) {
            if (eventType === 'C' && resourceType === 'Patient') {
                await this.onPatientCreateAsync(
                    {
                        requestId, patientId, timestamp: currentDate
                    });
            } else {
                await this.onPatientChangeAsync({
                        requestId, patientId, timestamp: currentDate
                    }
                );
            }
        }
        if (resourceType === 'Task') {
            if (eventType === 'C') {
                await this.onTaskCreateAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            } else {
                await this.onTaskChangeAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            }
        }
    }

    /**
     * flushes the change event buffer
     * @param {string} requestId
     * @return {Promise<void>}
     */
    async flushAsync(requestId) {
        if (!env.ENABLE_EVENTS_KAFKA) {
            this.patientMessageMap.clear();
            return;
        }
        if (this.patientMessageMap.size === 0) {
            return;
        }

        // find unique events
        const fhirVersion = 'R4';
        await mutex.runExclusive(async () => {
                const numberOfMessagesBefore = this.patientMessageMap.size + this.taskMessageMap.size;
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const patientMessages = Array.from(
                    this.patientMessageMap.entries(),
                    ([/** @type {string} */ id, /** @type {Object} */ messageJson]) => {
                        return {
                            key: id,
                            fhirVersion: fhirVersion,
                            requestId: requestId,
                            value: JSON.stringify(messageJson)
                        };
                    }
                );

                await this.kafkaClient.sendMessagesAsync(this.patientChangeTopic, patientMessages);

                this.patientMessageMap.clear();

                /**
                 * @type {KafkaClientMessage[]}
                 */
                const taskMessages = Array.from(
                    this.taskMessageMap.entries(),
                    ([/** @type {string} */ id, /** @type {Object} */ messageJson]) => {
                        return {
                            key: id,
                            fhirVersion: fhirVersion,
                            requestId: requestId,
                            value: JSON.stringify(messageJson)
                        };
                    }
                );

                await this.kafkaClient.sendMessagesAsync(this.taskChangeTopic, taskMessages);

                this.taskMessageMap.clear();

                if (numberOfMessagesBefore > 0) {
                    await logSystemEventAsync(
                        {
                            event: 'changeEventProducer',
                            message: 'Finished',
                            args: {
                                numberOfMessagesBefore: numberOfMessagesBefore,
                                numberOfMessagesAfter: this.patientMessageMap.size + this.taskMessageMap.size,
                                patientTopic: this.patientChangeTopic,
                                taskTopic: this.taskChangeTopic
                            }
                        }
                    );
                }
            }
        );
    }
}

module.exports = {
    ChangeEventProducer
};
