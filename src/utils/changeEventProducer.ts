const env = require('var');
const {generateUUID} = require('./uid.util');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {KafkaClient} = require('./kafkaClient');
const {ResourceManager} = require('../operations/common/resourceManager');
const {logSystemEventAsync} = require('../operations/common/logging');
const AuditEvent = require('../fhir/classes/4_0_0/resources/auditEvent');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const AuditEventAgent = require('../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const AuditEventSource = require('../fhir/classes/4_0_0/backbone_elements/auditEventSource');
const Period = require('../fhir/classes/4_0_0/complex_types/period');
const {BwellPersonFinder} = require('./bwellPersonFinder');
const {RequestSpecificCache} = require('./requestSpecificCache');

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
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor({
                    kafkaClient,
                    resourceManager,
                    patientChangeTopic,
                    taskChangeTopic,
                    observationChangeTopic,
                    bwellPersonFinder,
                    requestSpecificCache
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
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);
        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * This map stores an entry per message id
     * @param {string} requestId
     * @return {Map<string, Object>} id, resource
     */
    getPatientMessageMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'PatientMessageMap'});
    }

    /**
     * This map stores an entry per task id
     * @param {string} requestId
     * @return {Map<string, Object>} id, resource
     */
    getTaskMessageMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'TaskMessageMap'});
    }

    /**
     * This map stores an entry per observation id
     * @param {string} requestId
     * @return {Map<string, Object>} id, resource
     */
    getObservationMessageMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'ObservationMessageMap'});
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
        const currentDate = moment.utc().format('YYYY-MM-DD');
        return new AuditEvent(
            {
                'id': generateUUID(),
                'action': isCreate ? 'C' : 'U',
                type: new Coding({
                    code: '110100'
                }),
                recorded: currentDate,
                'period':
                    new Period({
                        'start': timestamp,
                        'end': timestamp
                    }),
                purposeOfEvent:
                    [
                        new CodeableConcept({
                            'coding':
                                [
                                    new Coding({
                                        'system': 'https://www.icanbwell.com/event-purpose',
                                        'code': eventName
                                    })
                                ]
                        })
                    ],
                agent:
                    [
                        new AuditEventAgent({
                            who: new Reference(
                                {
                                    'reference': `${resourceType}/${id}`
                                }),
                            requestor: true
                        })
                    ],
                source: new AuditEventSource({
                    'site': requestId,
                    observer: new Reference(
                        {reference: 'Organization/bwell'}
                    )
                })
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
        this.getPatientMessageMap({requestId}).set(key, messageJson);
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
        const patientMessageMap = this.getPatientMessageMap({requestId});
        const existingMessageEntry = patientMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            patientMessageMap.set(key, messageJson);
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
        this.getTaskMessageMap({requestId}).set(key, messageJson);
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
        const taskMessageMap = this.getTaskMessageMap({requestId});
        const existingMessageEntry = taskMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            taskMessageMap.set(key, messageJson);
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
        const taskMessageMap = this.getTaskMessageMap({requestId});
        const existingMessageEntry = taskMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            taskMessageMap.set(key, messageJson);
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
        const taskMessageMap = this.getTaskMessageMap({requestId});
        const existingMessageEntry = taskMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            taskMessageMap.set(key, messageJson);
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
        this.getObservationMessageMap({requestId}).set(key, messageJson);
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
        const observationMessageMap = this.getObservationMessageMap({requestId});
        const existingMessageEntry = observationMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            observationMessageMap.set(key, messageJson);
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
        const observationMessageMap = this.getObservationMessageMap({requestId});
        const existingMessageEntry = observationMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            observationMessageMap.set(key, messageJson);
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
        const observationMessageMap = this.getObservationMessageMap({requestId});
        const existingMessageEntry = observationMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            observationMessageMap.set(key, messageJson);
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

                let personId = await this.bwellPersonFinder.getBwellPersonIdAsync({patientId: patientId});
                if (personId) {
                    const proxyPatientId = `person.${personId}`;
                    await this.onPatientChangeAsync({
                            requestId, patientId: proxyPatientId, timestamp: currentDate
                        }
                    );
                }
            }
        }
        if (resourceType === 'Person') {
            const proxyPatientId = `person.${doc.id}`;
            if (eventType === 'C') {
                await this.onPatientCreateAsync({
                        requestId, patientId: proxyPatientId, timestamp: currentDate
                    }
                );
            } else {
                await this.onPatientChangeAsync({
                        requestId, patientId: proxyPatientId, timestamp: currentDate
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
    async flushAsync({requestId}) {
        const patientMessageMap = this.getPatientMessageMap({requestId});
        if (!env.ENABLE_EVENTS_KAFKA) {
            patientMessageMap.clear();
            return;
        }
        if (patientMessageMap.size === 0) {
            return;
        }

        // find unique events
        const fhirVersion = 'R4';
        await mutex.runExclusive(async () => {
            const taskMessageMap = this.getTaskMessageMap({requestId});
            const observationMessageMap = this.getObservationMessageMap({requestId});
            const numberOfMessagesBefore = patientMessageMap.size + taskMessageMap.size + observationMessageMap.size;
                // --- Process Patient events ---
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const patientMessages = Array.from(
                    patientMessageMap.entries(),
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

                patientMessageMap.clear();

                // --- Process Task events ---
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const taskMessages = Array.from(
                    taskMessageMap.entries(),
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

                taskMessageMap.clear();

                // --- Process Observation events ---
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const observationMessages = Array.from(
                    observationMessageMap.entries(),
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

                observationMessageMap.clear();

                if (numberOfMessagesBefore > 0) {
                    await logSystemEventAsync(
                        {
                            event: 'changeEventProducer',
                            message: 'Finished',
                            args: {
                                numberOfMessagesBefore: numberOfMessagesBefore,
                                numberOfMessagesAfter: patientMessageMap.size + taskMessageMap.size + observationMessageMap.size,
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
