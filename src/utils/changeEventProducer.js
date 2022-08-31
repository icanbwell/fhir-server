const env = require('var');
const {generateUUID} = require('./uid.util');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {KafkaClient} = require('./kafkaClient');
const {ResourceManager} = require('../operations/common/resourceManager');
const {logSystemEventAsync} = require('../operations/common/logging');
const AuditEvent = require('../fhir/classes/4_0_0/resources/auditEvent');

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
     * @param {string} observationChangeTopic
     */
    constructor({
                    kafkaClient,
                    resourceManager,
                    patientChangeTopic,
                    taskChangeTopic,
                    observationChangeTopic
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
         * @type {string}
         */
        this.observationChangeTopic = observationChangeTopic;
        assertIsValid(observationChangeTopic);
        /**
         * id, resource
         * @type {Map<string, Object>}
         */
        this.patientMessageMap = new Map();
        /**
         * id, resource
         * @type {Map<string, Object>}
         */
        this.taskMessageMap = new Map();
        /**
         * id, resource
         * @type {Map<string, Object>}
         */
        this.observationMessageMap = new Map();
    }

    /**
     * Creates a message
     * @param {string} requestId
     * @param {string} id
     * @param {string} timestamp
     * @param {boolean} isCreate
     * @param {string} resourceType
     * @param {string} eventName
     * @return {AuditEvent}
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
        return new AuditEvent({
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
        });
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
        const existingMessageEntry = this.taskMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.taskMessageMap.set(key, messageJson);
        }
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onTaskCompleteAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = false;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Task Complete'
        });

        const key = `${id}`;
        const existingMessageEntry = this.taskMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.taskMessageMap.set(key, messageJson);
        }
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onTaskCanceledAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = false;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Task Canceled'
        });

        const key = `${id}`;
        const existingMessageEntry = this.taskMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.taskMessageMap.set(key, messageJson);
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
    async onObservationCreateAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = true;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Observation Create'
        });
        const key = `${id}`;
        this.observationMessageMap.set(key, messageJson);
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onObservationChangeAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = false;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Observation Change'
        });

        const key = `${id}`;
        const existingMessageEntry = this.observationMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.observationMessageMap.set(key, messageJson);
        }
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onObservationCompleteAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = false;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Observation Complete'
        });

        const key = `${id}`;
        const existingMessageEntry = this.observationMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.observationMessageMap.set(key, messageJson);
        }
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @return {Promise<void>}
     */
    async onObservationCanceledAsync({requestId, id, resourceType, timestamp}) {
        const isCreate = false;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Observation Canceled'
        });

        const key = `${id}`;
        const existingMessageEntry = this.observationMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            this.observationMessageMap.set(key, messageJson);
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
            } else if (doc.status === 'completed') {
                await this.onTaskCompleteAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            } else if (doc.status === 'cancelled') {
                await this.onTaskCanceledAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            } else {
                await this.onTaskChangeAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            }
        }
        if (resourceType === 'Observation') {
            if (eventType === 'C') {
                await this.onObservationCreateAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            } else if (doc.status === 'final') {
                await this.onObservationCompleteAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            } else if (doc.status === 'cancelled') {
                await this.onObservationCanceledAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate
                });
            } else {
                await this.onObservationChangeAsync({
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
                const numberOfMessagesBefore = this.patientMessageMap.size + this.taskMessageMap.size + this.observationMessageMap.size;
                // --- Process Patient events ---
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

                // --- Process Task events ---
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

                // --- Process Observation events ---
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const observationMessages = Array.from(
                    this.observationMessageMap.entries(),
                    ([/** @type {string} */ id, /** @type {Object} */ messageJson]) => {
                        return {
                            key: id,
                            fhirVersion: fhirVersion,
                            requestId: requestId,
                            value: JSON.stringify(messageJson)
                        };
                    }
                );

                await this.kafkaClient.sendMessagesAsync(this.observationChangeTopic, observationMessages);

                this.observationMessageMap.clear();

                if (numberOfMessagesBefore > 0) {
                    await logSystemEventAsync(
                        {
                            event: 'changeEventProducer',
                            message: 'Finished',
                            args: {
                                numberOfMessagesBefore: numberOfMessagesBefore,
                                numberOfMessagesAfter: this.patientMessageMap.size + this.taskMessageMap.size + this.observationMessageMap.size,
                                patientTopic: this.patientChangeTopic,
                                taskTopic: this.taskChangeTopic,
                                observationTopic: this.observationChangeTopic
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
