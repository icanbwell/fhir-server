const { assertTypeEquals } = require('./assertType');
const { KafkaClient } = require('./kafkaClient');
const { BasePostSaveHandler } = require('./basePostSaveHandler');
const { RethrownError } = require('./rethrownError');
const { ConfigManager } = require('./configManager');
const { PatientFilterManager } = require('../fhir/patientFilterManager');
const { logError } = require('../operations/common/logging');
const { CLOUD_EVENT, PERSON_PROXY_PREFIX, PATIENT_REFERENCE_PREFIX } = require('../constants');
const { CloudEvent, Kafka } = require('cloudevents');
const { generateUUID } = require('./uid.util');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { NestedPropertyReader } = require('./nestedPropertyReader');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

const CLOUD_EVENT_TYPES = {
    PATIENT: 'PatientDataChangeEvent',
    PERSON: 'PersonDataChangeEvent'
};

/**
 * This class is used to produce patient person data change events
 */
class PatientPersonDataChangeEventProducer extends BasePostSaveHandler {
    /**
     * Constructor
     * @typedef {Object} Params
     * @property {KafkaClient} kafkaClient
     * @property {ConfigManager} configManager
     * @property {PatientFilterManager} patientFilterManager
     * @property {DatabaseQueryFactory} databaseQueryFactory
     *
     * @param {Params}
     */
    constructor({ kafkaClient, configManager, patientFilterManager, databaseQueryFactory }) {
        super();
        /**
         * @type {KafkaClient}
         */
        this.kafkaClient = kafkaClient;
        assertTypeEquals(kafkaClient, KafkaClient);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {Map}
         */
        this.patientDataChangeMap = new Map();
        /**
         * @type {Map}
         */
        this.personDataChangeMap = new Map();

        /**
         * @type {boolean}
         */
        this.enablePersonDataChangeEvents = configManager.enablePersonDataChangeEvents;

        /**
         * @type {boolean}
         */
        this.enablePatientDataChangeEvents = configManager.enablePatientDataChangeEvents;

        /**
         * @type {boolean}
         */
        this.dataChangeEventsEnabled =
            configManager.kafkaEnableEvents &&
            (this.enablePersonDataChangeEvents || this.enablePatientDataChangeEvents);

        /**
         * @type {string}
         */
        this.patientDataChangeEventTopic = configManager.patientDataChangeEventTopic;

        /**
         * @type {string}
         */
        this.personDataChangeEventTopic = configManager.personDataChangeEventTopic;

        /**
         * @type {number}
         */
        this.maxBufferSize = configManager.postRequestBatchSize;
    }

    /**
     * Populates person data change map based on patient data change map
     * @param {Map<string, string[]>} patientDataMapBuffer
     * @param {Map<string, string[]>} personDataMapBuffer
     * @private
     */
    async _populatePersonDataChangeMapAsync(patientDataMapBuffer, personDataMapBuffer) {
        const patientIds = Array.from(patientDataMapBuffer.keys());
        if (patientIds.length === 0) {
            return;
        }

        const personResourcesCursor = await this.databaseQueryFactory
            .createQuery({ resourceType: 'Person', base_version: '4_0_0' })
            .findAsync({
                query: { 'link.target._uuid': { $in: patientIds.map((id) => `Patient/${id}`) } },
                options: {
                    projection: { _uuid: 1, 'link.target._uuid': 1 }
                }
            });
        const personResources = await personResourcesCursor.toArrayAsync();

        for (const personResource of personResources) {
            const personId = personResource._uuid;
            const personChangedResourceTypes = new Set(personDataMapBuffer.get(personId) || []);
            for (const link of personResource.link || []) {
                const targetRef = link.target;
                if (
                    targetRef &&
                    typeof targetRef === 'object' &&
                    targetRef._uuid &&
                    targetRef._uuid.startsWith('Patient/')
                ) {
                    const patientId = targetRef._uuid.split('/')[1];
                    const resourceTypes = patientDataMapBuffer.get(patientId);
                    if (!resourceTypes) {
                        continue;
                    }
                    for (const resourceType of resourceTypes) {
                        personChangedResourceTypes.add(resourceType);
                    }
                }
            }
            personDataMapBuffer.set(personId, Array.from(personChangedResourceTypes));
        }
    }

    /**
     * Creates message for Patient or Person Data Change event using CloudEvent
     * @param {string} resourceId
     * @param {string} resourceType
     * @param {string[]} changedResourceTypes
     * @return {Object}
     * @private
     */
    _createCloudEvent({ resourceId, resourceType, changedResourceTypes }) {
        const eventPayload = {
            source: CLOUD_EVENT.SOURCE,
            type: CLOUD_EVENT_TYPES[resourceType.toUpperCase()],
            datacontenttype: 'application/json;charset=utf-8',
            data: JSON.stringify({
                id: resourceId,
                resourceType,
                changedResourceTypes
            })
        };

        const cloudEvent = new CloudEvent(eventPayload);
        const message = Kafka.binary(cloudEvent);

        // Filter out undefined headers that kafkajs doesn't allow
        const eventHeaders = this._cleanHeaders(message.headers);

        return {
            key: generateUUID(),
            value: message.body,
            headers: eventHeaders
        };
    }

    /**
     * Remove undefined headers
     * @param {Object} headers
     * @return {Object}
     * @private
     */
    _cleanHeaders(headers) {
        return Object.keys(headers).reduce((acc, key) => {
            return headers[key] === undefined ? acc : { ...acc, [key]: headers[key] };
        }, {});
    }

    /**
     * Adds resource to change event map
     * @param {string} id
     * @param {string} resourceType
     * @param {string} changedResourceType
     */
    addResourceToChangeEventMap({ id, resourceType, changedResourceType }) {
        if (!id || !changedResourceType || (!this.enablePersonDataChangeEvents && resourceType === 'Person')) {
            return;
        }

        const dataChangeMap = resourceType === 'Person' ? this.personDataChangeMap : this.patientDataChangeMap;
        const existingResourceTypes = dataChangeMap.get(id) || [];

        // avoiding duplicates
        if (existingResourceTypes.includes(changedResourceType)) {
            return;
        }
        const mergedResourceTypes = existingResourceTypes.concat(changedResourceType);

        dataChangeMap.set(id, mergedResourceTypes);
    }

    /**
     * Extract and validate patient reference
     * @param {string} resourceReference
     * @param {string} resourceType
     * @param {string} docId
     * @param {string} requestId
     * @param {string} eventType
     * @return {string|null}
     * @private
     */
    _extractPatientReferenceId(resourceReference, resourceType, docId, requestId, eventType) {
        if (
            !resourceReference ||
            typeof resourceReference !== 'string' ||
            !resourceReference.startsWith(PATIENT_REFERENCE_PREFIX)
        ) {
            logError(`Invalid patient reference for resource ${resourceType} with id ${docId}`, {
                reference: resourceReference,
                requestId,
                eventType
            });
            return null;
        }

        const referencedResourceId = resourceReference.split('/')[1];
        if (!referencedResourceId) {
            logError(
                `Could not extract patient/person id from reference for resource ${resourceType} with id ${docId}`,
                { reference: resourceReference, requestId, eventType }
            );
            return null;
        }

        return referencedResourceId;
    }

    /**
     * Parse resource reference to determine if it's a person or patient
     * @param {string} referencedResourceId
     * @return {{id: string, referencedResourceType: string}}
     * @private
     */
    _parsePatientReferenceId(referencedResourceId) {
        if (referencedResourceId.startsWith(PERSON_PROXY_PREFIX)) {
            return {
                id: referencedResourceId.replace(PERSON_PROXY_PREFIX, ''),
                referencedResourceType: 'Person'
            };
        }

        return {
            id: referencedResourceId,
            referencedResourceType: 'Patient'
        };
    }

    /**
     * Fires events when data of person or patient is changed
     * @param {string} requestId
     * @param {string} eventType.  Can be C = create or U = update or D = delete
     * @param {string} resourceType
     * @param {Resource} doc
     */
    async afterSaveAsync({ requestId, eventType, resourceType, doc }) {
        try {
            if (!this.dataChangeEventsEnabled || resourceType === 'AuditEvent') {
                return;
            }
            if (resourceType === 'Person') {
                this.addResourceToChangeEventMap({
                    id: doc._uuid,
                    resourceType,
                    changedResourceType: resourceType
                });
            } else if (resourceType === 'Patient') {
                this.addResourceToChangeEventMap({
                    id: doc._uuid,
                    resourceType,
                    changedResourceType: resourceType
                });
            } else {
                // Check if resource is patient related
                let patientProperty = this.patientFilterManager.getPatientPropertyForResource({ resourceType });
                if (!patientProperty) {
                    return;
                }
                // Adjust for reference to uuid field
                patientProperty = patientProperty.replace('reference', '_uuid');

                /*
                 *@type {string|string[]}
                 */
                let resourceReferences = NestedPropertyReader.getNestedProperty({ obj: doc, path: patientProperty });

                resourceReferences = Array.isArray(resourceReferences) ? resourceReferences : [resourceReferences];

                for (const resourceReference of resourceReferences) {
                    const referencedResourceId = this._extractPatientReferenceId(
                        resourceReference,
                        resourceType,
                        doc._uuid,
                        requestId,
                        eventType
                    );

                    if (!referencedResourceId) {
                        continue;
                    }

                    const { id, referencedResourceType } = this._parsePatientReferenceId(referencedResourceId);
                    if (id) {
                        this.addResourceToChangeEventMap({
                            id,
                            resourceType: referencedResourceType,
                            changedResourceType: resourceType
                        });
                    }
                }
            }

            if (this.patientDataChangeMap.size + this.personDataChangeMap.size >= this.maxBufferSize) {
                await this.flushAsync();
            }
        } catch (e) {
            throw new RethrownError({
                message: 'Error in PatientPersonDataChangeEventProducer.afterSaveAsync(): ',
                error: e.stack,
                args: {
                    message: e.message
                }
            });
        }
    }

    /**
     * flushes the change event buffer
     * @return {Promise<void>}
     */
    async flushAsync() {
        if (this.patientDataChangeMap.size === 0 && this.personDataChangeMap.size === 0) {
            return;
        }

        await mutex.runExclusive(async () => {
            try {
                // Move current data to processing buffers
                const patientDataChangeMapBuffer = new Map(this.patientDataChangeMap);
                this.patientDataChangeMap.clear();

                const personDataChangeMapBuffer = new Map(this.personDataChangeMap);
                this.personDataChangeMap.clear();

                if (this.enablePatientDataChangeEvents) {
                    // Process patient data change events
                    await this._processDataChangeEvents({
                        topic: this.patientDataChangeEventTopic,
                        dataChangeMap: patientDataChangeMapBuffer,
                        resourceType: 'Patient'
                    });
                }

                if (this.enablePersonDataChangeEvents) {
                    // Populate person data change map from patient data change map
                    await this._populatePersonDataChangeMapAsync(patientDataChangeMapBuffer, personDataChangeMapBuffer);

                    // Process person data change events
                    await this._processDataChangeEvents({
                        topic: this.personDataChangeEventTopic,
                        dataChangeMap: personDataChangeMapBuffer,
                        resourceType: 'Person'
                    });
                }

                // Clear processing buffers
                patientDataChangeMapBuffer.clear();
                personDataChangeMapBuffer.clear();
            } catch (e) {
                logError('Error in PatientPersonDataChangeEventProducer.flushAsync(): ', { error: e });
            }
        });
    }

    /**
     * Process data change events for patient or person
     * @param {string} topic
     * @param {Map<string, string[]>} changeDataMap
     * @param {string} resourceType
     * @return {Promise<void>}
     * @private
     */
    async _processDataChangeEvents({ topic, dataChangeMap, resourceType }) {
        if (dataChangeMap.size === 0) {
            return;
        }

        const messages = Array.from(dataChangeMap.entries()).map(([id, changedResourceTypes]) =>
            this._createCloudEvent({ resourceType, resourceId: id, changedResourceTypes })
        );

        await this.kafkaClient.sendCloudEventMessageAsync({ topic, messages });
    }
}

module.exports = {
    PatientPersonDataChangeEventProducer
};
