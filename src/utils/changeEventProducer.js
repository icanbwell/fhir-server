const env = require('var');
const {generateUUID} = require('./uid.util');
const moment = require('moment-timezone');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {ResourceManager} = require('../operations/common/resourceManager');
const {logTraceSystemEventAsync} = require('../operations/common/logging');
const AuditEvent = require('../fhir/classes/4_0_0/resources/auditEvent');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const AuditEventAgent = require('../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const AuditEventSource = require('../fhir/classes/4_0_0/backbone_elements/auditEventSource');
const Period = require('../fhir/classes/4_0_0/complex_types/period');
const {BwellPersonFinder} = require('./bwellPersonFinder');
const {RequestSpecificCache} = require('./requestSpecificCache');
const {KafkaClientFactory} = require('./kafkaClientFactory');
const { ConfigManager } = require('./configManager');
const { SensitiveDataProcessor } = require('./sensitiveDataProcessor');
const { PatientFilterManager } = require('../fhir/patientFilterManager');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * This class is used to produce change events
 */
class ChangeEventProducer {
    /**
     * Constructor
     * @param {KafkaClientFactory} kafkaClientFactory
     * @param {ResourceManager} resourceManager
     * @param {string} patientChangeTopic
     * @param {string} consentChangeTopic
     * @param {BwellPersonFinder} bwellPersonFinder
     * @param {RequestSpecificCache} requestSpecificCache
     * @param {ConfigManager} configManager
     * @param {SensitiveDataProcessor} sensitiveDataProcessor
     * @param {PatientFilterManager} patientFilterManager
     */
    constructor({
                    kafkaClientFactory,
                    resourceManager,
                    patientChangeTopic,
                    consentChangeTopic,
                    bwellPersonFinder,
                    requestSpecificCache,
                    configManager,
                    sensitiveDataProcessor,
                    patientFilterManager,
                }) {
        /**
         * @type {KafkaClientFactory}
         */
        this.kafkaClientFactory = kafkaClientFactory;
        assertTypeEquals(kafkaClientFactory, KafkaClientFactory);
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
        this.consentChangeTopic = consentChangeTopic;
        assertIsValid(consentChangeTopic);
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

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {SensitiveDataProcessor}
         */
        this.sensitiveDataProcessor = sensitiveDataProcessor;
        assertTypeEquals(sensitiveDataProcessor, SensitiveDataProcessor);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);
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
     * This map stores an entry per consent id
     * @param {string} requestId
     * @return {Map<string, Object>} id, resource
     */
    getConsentMessageMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'ConsentMessageMap'});
    }

    /**
     * Creates a message
     * @param {string} requestId
     * @param {string} id
     * @param {string} timestamp
     * @param {boolean} isCreate
     * @param {string} resourceType
     * @param {string} eventName
     * @param {string} sourceType
     * @return {AuditEvent}
     * @private
     */
    _createMessage({
                       requestId,
                       id,
                       timestamp,
                       isCreate,
                       resourceType,
                       eventName,
                       sourceType
                   }
    ) {
        const currentDate = moment.utc().format('YYYY-MM-DD');
        let auditEvent = new AuditEvent(
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
        if (sourceType) {
            auditEvent.source.type = new Coding({system: 'https://www.icanbwell.com/sourceType', code: sourceType});
        }
        return auditEvent;
    }

    /**
     * Fire event for patient create
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @param {string} sourceType
     * @return {Promise<void>}
     */
    async onPatientCreateAsync({requestId, patientId, timestamp, sourceType}) {
        const isCreate = true;

        const resourceType = 'Patient';
        const messageJson = this._createMessage({
            requestId,
            id: patientId,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Patient Create',
            sourceType
        });
        const key = `${patientId}`;
        this.getPatientMessageMap({requestId}).set(key, messageJson);
    }

    /**
     * Fire event for patient change
     * @param {string} requestId
     * @param {string} patientId
     * @param {string} timestamp
     * @param {string} sourceType
     * @return {Promise<void>}
     */
    async onPatientChangeAsync({requestId, patientId, timestamp, sourceType}) {
        const isCreate = false;

        const resourceType = 'Patient';
        const messageJson = this._createMessage({
            requestId, id: patientId, timestamp, isCreate,
            resourceType: resourceType,
            eventName: 'Patient Change',
            sourceType
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
     * Fire event for consent create
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @param {string} sourceType
     * @return {Promise<void>}
     */
    async onConsentCreateAsync({requestId, id, resourceType, timestamp, sourceType}) {
        const isCreate = true;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Consent Create',
            sourceType
        });
        const key = `${id}`;
        this.getConsentMessageMap({requestId}).set(key, messageJson);
    }

    /**
     * Fire event for consent change
     * @param {string} requestId
     * @param {string} id
     * @param {string} resourceType
     * @param {string} timestamp
     * @param {string} sourceType
     * @return {Promise<void>}
     */
    async onConsentChangeAsync({requestId, id, resourceType, timestamp, sourceType}) {
        const isCreate = false;

        const messageJson = this._createMessage({
            requestId,
            id,
            timestamp,
            isCreate,
            resourceType: resourceType,
            eventName: 'Consent Change',
            sourceType
        });

        const key = `${id}`;
        const consentMessageMap = this.getConsentMessageMap({requestId});
        const existingMessageEntry = consentMessageMap.get(key);
        if (!existingMessageEntry || existingMessageEntry.action !== 'C') {
            // if existing entry is a 'create' then leave it alone
            consentMessageMap.set(key, messageJson);
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

        let sourceType;
        if (doc.extension && doc.extension.some(x => x.url === 'https://www.icanbwell.com/sourceType')) {
            sourceType = doc.extension.find(x => x.url === 'https://www.icanbwell.com/sourceType').valueString;
        }

        /**
         * @type {string|null}
         */
        const patientId = await this.resourceManager.getPatientIdFromResourceAsync(resourceType, doc);
        await logTraceSystemEventAsync(
            {
                event: 'fireEventsAsync' + `_${resourceType}`,
                message: 'Fire Events',
                args: {
                    resourceType,
                    requestId,
                    eventType,
                    doc,
                    patientId
                }
            }
        );
        if (patientId) {
            if (eventType === 'C' && resourceType === 'Patient') {
                await this.onPatientCreateAsync(
                    {
                        requestId, patientId, timestamp: currentDate, sourceType
                    });
            } else {
                await this.onPatientChangeAsync({
                        requestId, patientId, timestamp: currentDate, sourceType
                    }
                );

                let personId = await this.bwellPersonFinder.getBwellPersonIdAsync({patientId: patientId});
                if (personId) {
                    const proxyPatientId = `person.${personId}`;
                    await this.onPatientChangeAsync({
                            requestId, patientId: proxyPatientId, timestamp: currentDate, sourceType
                        }
                    );
                }
            }
        }
        if (resourceType === 'Person' && this.bwellPersonFinder.isBwellPerson(doc)) {
            const proxyPatientId = `person.${doc.id}`;
            if (eventType === 'C') {
                await this.onPatientCreateAsync({
                        requestId, patientId: proxyPatientId, timestamp: currentDate, sourceType
                    }
                );
            } else {
                await this.onPatientChangeAsync({
                        requestId, patientId: proxyPatientId, timestamp: currentDate, sourceType
                    }
                );
            }
        }
        if (resourceType === 'Consent') {
            if (eventType === 'C') {
                await this.onConsentCreateAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate, sourceType
                });
            } else {
                await this.onConsentChangeAsync({
                    requestId, id: doc.id, resourceType, timestamp: currentDate, sourceType
                });
            }
            if (this.configManager.enabledAccessTagUpdate) {
                // eslint-disable-next-line no-unused-vars
                const updatedResources = await this.sensitiveDataProcessor.updatePatientRelatedResources({
                    resource: doc
                });
                // TODO: Update all resources returned, handle circular dependency.
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
                const consentMessageMap = this.getConsentMessageMap({requestId});
                const numberOfMessagesBefore = patientMessageMap.size + consentMessageMap.size;

                const createKafkaClientMessageFn = ([/** @type {string} */ id, /** @type {Object} */ messageJson]) => {
                    return {
                        key: id,
                        fhirVersion: fhirVersion,
                        requestId: requestId,
                        value: JSON.stringify(messageJson),
                    };
                };
                // --- Process Patient events ---
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const patientMessages = Array.from(
                    patientMessageMap.entries(), createKafkaClientMessageFn
                );

                /**
                 * @type {DummyKafkaClient|KafkaClient}
                 */
                const kafkaClient = await this.kafkaClientFactory.createKafkaClientAsync();

                await kafkaClient.sendMessagesAsync(this.patientChangeTopic, patientMessages);

                patientMessageMap.clear();

                // --- Process Consent events ---
                /**
                 * @type {KafkaClientMessage[]}
                 */
                const consentMessages = Array.from(
                    consentMessageMap.entries(), createKafkaClientMessageFn
                );

                await kafkaClient.sendMessagesAsync(this.consentChangeTopic, consentMessages);

                consentMessageMap.clear();

                if (numberOfMessagesBefore > 0) {
                    await logTraceSystemEventAsync(
                        {
                            event: 'changeEventProducer',
                            message: 'Finished',
                            args: {
                                numberOfMessagesBefore: numberOfMessagesBefore,
                                numberOfMessagesAfter: patientMessageMap.size + consentMessageMap.size,
                                patientTopic: this.patientChangeTopic,
                                consentTopic: this.consentChangeTopic
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
