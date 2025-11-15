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
         * @type {Map}
         */
        this.patientDataChangeMapBuffer = new Map();
        /**
         * @type {Map}
         */
        this.personDataChangeMapBuffer = new Map();

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
     * This map stores an entry per resource id
     * @param {boolean} isPerson
     * @param {boolean} useBuffer - whether to use the buffer maps
     * @return {Map<string, List[String]>}
     */
    getPersonPatientDataChangeMap(isPerson = false, useBuffer = false) {
        if (useBuffer) {
            return isPerson ? this.personDataChangeMapBuffer : this.patientDataChangeMapBuffer;
        }
        return isPerson ? this.personDataChangeMap : this.patientDataChangeMap;
    }

    /**
     * Check if any events are buffered
     * @return {boolean}
     */
    hasBufferedEvents() {
        return this.patientDataChangeMap.size > 0 || this.personDataChangeMap.size > 0;
    }

    /**
     * Get total buffered events count
     * @return {number}
     */
    getBufferedEventsCount() {
        return this.patientDataChangeMap.size + this.personDataChangeMap.size;
    }

    /**
     * Populates person data change map based on patient data change map
     * @param {boolean} useBuffer - whether to use buffer maps
     * @private
     */
    async _populatePersonDataChangeMapAsync(useBuffer = false) {
        const patientDataMap = this.getPersonPatientDataChangeMap(false, useBuffer);
        const patientIds = Array.from(patientDataMap.keys());
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
            for (const link of personResource.link || []) {
                const targetRef = link.target;
                if (
                    targetRef &&
                    typeof targetRef === 'object' &&
                    targetRef._uuid &&
                    targetRef._uuid.startsWith('Patient/')
                ) {
                    const patientId = targetRef._uuid.split('/')[1];
                    const resourceTypes = patientDataMap.get(patientId);
                    if (!resourceTypes) {
                        continue;
                    }
                    this.addResourceToChangeEventBuffer({
                        resourceTypes,
                        id: personResource._uuid,
                        isPerson: true,
                        useBuffer
                    });
                }
            }
        }
    }

    /**
     * Creates message for Patient or Person Data Change event using CloudEvent
     * @return {Object}
     * @private
     */
    _createCloudEvent({ isPerson, resourceId, resourceTypes }) {
        const eventPayload = {
            source: CLOUD_EVENT.SOURCE,
            type: isPerson ? CLOUD_EVENT_TYPES.PERSON : CLOUD_EVENT_TYPES.PATIENT,
            datacontenttype: 'application/json;charset=utf-8',
            data: JSON.stringify({
                id: resourceId,
                resourceType: isPerson ? 'Person' : 'Patient',
                changedResourceTypes: resourceTypes
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
     * Adds resource to change event buffer
     * @param {string[]} resourceTypes
     * @param {string} id
     * @param {boolean} isPerson
     * @param {boolean} useBuffer - whether to use buffer maps
     */
    addResourceToChangeEventBuffer({ resourceTypes, id, isPerson, useBuffer = false }) {
        if (!id || !resourceTypes?.length || (!this.enablePersonDataChangeEvents && isPerson)) {
            return;
        }

        const dataChangeMap = this.getPersonPatientDataChangeMap(isPerson, useBuffer);
        const existingResourceTypes = dataChangeMap.get(id) || [];

        // Merge resource types, avoiding duplicates
        const mergedResourceTypes = [
            ...existingResourceTypes,
            ...resourceTypes.filter((type) => !existingResourceTypes.includes(type))
        ];

        dataChangeMap.set(id, mergedResourceTypes);
    }

    /**
     * Extract and validate patient reference
     * @param {string} resourceReference
     * @param {string} resourceType
     * @param {string} docId
     * @return {string|null}
     * @private
     */
    _extractPatientReferenceId(resourceReference, resourceType, docId) {
        if (
            !resourceReference ||
            typeof resourceReference !== 'string' ||
            !resourceReference.startsWith(PATIENT_REFERENCE_PREFIX)
        ) {
            logError(`Invalid patient reference for resource ${resourceType} with id ${docId}`, {
                reference: resourceReference
            });
            return null;
        }

        const referencedResourceId = resourceReference.split('/')[1];
        if (!referencedResourceId) {
            logError(
                `Could not extract patient/person id from reference for resource ${resourceType} with id ${docId}`,
                { reference: resourceReference }
            );
            return null;
        }

        return referencedResourceId;
    }

    /**
     * Parse resource reference to determine if it's a person or patient
     * @param {string} referencedResourceId
     * @return {{id: string, isPerson: boolean}}
     * @private
     */
    _parsePatientReferenceId(referencedResourceId) {
        if (referencedResourceId.startsWith(PERSON_PROXY_PREFIX)) {
            return {
                id: referencedResourceId.replace(PERSON_PROXY_PREFIX, ''),
                isPerson: true
            };
        }

        return {
            id: referencedResourceId,
            isPerson: false
        };
    }

    /**
     * Fires events when data of person or patient is changed
     * @param {string} resourceType
     * @param {Resource} doc
     */
    async afterSaveAsync({ resourceType, doc }) {
        try {
            if (resourceType === 'AuditEvent') {
                return;
            }
            if (resourceType === 'Person') {
                this.addResourceToChangeEventBuffer({ resourceTypes: [resourceType], id: doc._uuid, isPerson: true });
            } else if (resourceType === 'Patient') {
                this.addResourceToChangeEventBuffer({ resourceTypes: [resourceType], id: doc._uuid, isPerson: false });
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
                        doc._uuid
                    );

                    if (!referencedResourceId) {
                        continue;
                    }

                    const { id, isPerson } = this._parsePatientReferenceId(referencedResourceId);
                    if (id) {
                        this.addResourceToChangeEventBuffer({
                            resourceTypes: [resourceType],
                            id,
                            isPerson
                        });
                    }
                }
            }

            if (this.getBufferedEventsCount() >= this.maxBufferSize) {
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
        if (!this.hasBufferedEvents()) {
            return;
        }

        await mutex.runExclusive(async () => {
            try {
                // Swap buffers - move current data to processing buffers
                this._swapBuffers();

                // Process patient data change events
                await this._processDataChangeEvents({
                    isPerson: false,
                    enabled: this.enablePatientDataChangeEvents,
                    topic: this.patientDataChangeEventTopic
                });

                // Process person data change events
                await this._processDataChangeEvents({
                    isPerson: true,
                    enabled: this.enablePersonDataChangeEvents,
                    topic: this.personDataChangeEventTopic
                });

                // Clear processing buffers
                this._clearProcessingBuffers();
            } catch (e) {
                logError('Error in PatientPersonDataChangeEventProducer.flushAsync(): ', { error: e });
            }
        });
    }

    /**
     * Process data change events for patient or person
     * @param {Object} options
     * @param {boolean} options.isPerson
     * @param {boolean} options.enabled
     * @param {string} options.topic
     * @return {Promise<void>}
     * @private
     */
    async _processDataChangeEvents({ isPerson, enabled, topic }) {
        if (!enabled) {
            return;
        }

        if (isPerson) {
            await this._populatePersonDataChangeMapAsync(true);
        }

        const dataChangeMap = this.getPersonPatientDataChangeMap(isPerson, true);
        if (dataChangeMap.size === 0) {
            return;
        }

        const messages = Array.from(dataChangeMap.entries()).map(([id, resourceTypes]) =>
            this._createCloudEvent({ isPerson, resourceId: id, resourceTypes })
        );

        await this.kafkaClient.sendCloudEventMessageAsync({ topic, messages });
    }

    /**
     * Swap current buffers with processing buffers
     * @private
     */
    _swapBuffers() {
        // Move current data to processing buffers
        this.patientDataChangeMapBuffer = new Map(this.patientDataChangeMap);
        this.personDataChangeMapBuffer = new Map(this.personDataChangeMap);

        // Clear current buffers for new incoming data
        this.patientDataChangeMap.clear();
        this.personDataChangeMap.clear();
    }

    /**
     * Clear processing buffers only
     * @private
     */
    _clearProcessingBuffers() {
        this.patientDataChangeMapBuffer.clear();
        this.personDataChangeMapBuffer.clear();
    }
}

module.exports = {
    PatientPersonDataChangeEventProducer
};
