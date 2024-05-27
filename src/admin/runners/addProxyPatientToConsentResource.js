const { ObjectId } = require('mongodb');
const deepEqual = require('fast-deep-equal');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { RethrownError } = require('../../utils/rethrownError');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { ReferenceParser } = require('../../utils/referenceParser');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const {
    PERSON_PROXY_PREFIX,
    PERSON_REFERENCE_PREFIX,
    PATIENT_REFERENCE_PREFIX,
    PROXY_PERSON_CONSENT_CODING
} = require('../../constants');
const ConsentActor = require('../../fhir/classes/4_0_0/backbone_elements/consentActor');
const { assertTypeEquals } = require('../../utils/assertType');
const { BwellPersonFinder } = require('../../utils/bwellPersonFinder');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');

const AvailableCollections = ['Consent_4_0_0', 'Consent_4_0_0_History'];
class AddProxyPatientToConsentResourceRunner extends BaseBulkOperationRunner {
    /**
     * @typedef AddProxyPatientToConsentResourceRunnerParams
     * @property {MongoCollectionManager} mongoCollectionManager
     * @property {number} batchSize
     * @property {AdminLogger} adminLogger
     * @property {MongoDatabaseManager} mongoDatabaseManager
     * @property {number|undefined} limit
     * @property {number|undefined} skip
     * @property {Array<'Consent_4_0_0' | 'Consent_4_0_0_History' | 'all'>} collections
     * @property {string | undefined} startFromId
     * @property {BwellPersonFinder} bwellPersonFinder
     * @property {PreSaveManager} preSaveManager
     * @property {boolean|undefined} useTransaction
     * @property {Date|undefined} beforeLastUpdatedDate
     * @property {Date|undefined} afterLastUpdatedDate
     * @param {AddProxyPatientToConsentResourceRunnerParams} options
     */
    constructor ({
        limit,
        startFromId,
        skip,
        collections,
        bwellPersonFinder,
        preSaveManager,
        useTransaction,
        beforeLastUpdatedDate,
        afterLastUpdatedDate,
        ...args
    }) {
        super(args);

        if (collections.length === 1 && collections[0] === 'all') {
            /** @type {string[]} */
            this.collections = [...AvailableCollections];
        } else {
            /** @type {string[]} */
            this.collections = collections.filter(
                (c) => AvailableCollections.includes(c)
            );
        }
        /** @type {number|undefined} */
        this.skip = skip;
        /** @type {number|undefined} */
        this.limit = limit;
        /** @type {string|undefined} */
        this.startFromId = startFromId;
        /** @type {boolean|undefined} */
        this.useTransaction = useTransaction;
        /** @type {Date|undefined} */
        this.afterLastUpdatedDate = afterLastUpdatedDate;
        /** @type {Date|undefined} */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;
        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /** @type {PreSaveManager} */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {Map<string, Map<string, string> | Set<string>>}
         */
        this.cache = new Map();

        Object.defineProperty(this, 'consentToImmediatePersonCache', {
            enumerable: true,
            get: function () {
                return this.cache.get('consentToImmediatePersonCache');
            },
            set (value) {
                this.cache.set('consentToImmediatePersonCache', value);
            }
        });

        Object.defineProperty(this, 'consentWithNoPerson', {
            enumerable: true,
            get: function () {
                return this.cache.get('consentWithNoPerson');
            },
            set (value) {
                this.cache.set('consentWithNoPerson', value);
            }
        });

        Object.defineProperty(this, 'consentToPatientWithMultiplePerson', {
            enumerable: true,
            get: function () {
                return this.cache.get('consentToPatientWithMultiplePerson');
            },
            set (value) {
                this.cache.set('consentToPatientWithMultiplePerson', value);
            }
        });

        /** @type {Map<string, { id: string; sourceAssigningAuthority: string}>} */
        this.consentToImmediatePersonCache = new Map();

        /** @type {Map<string, string>} */
        this.consentWithNoPerson = new Map();

        /** @type {Map<string, string>} */
        this.consentToPatientWithMultiplePerson = new Map();

        this.adminLogger.logInfo('Args', { limit, startFromId, skip, collections });
    }

    /**
     * Runs a loop to process records async
     * @returns {Promise<void>}
     */
    async processAsync () {
        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
        // preload the cache
        await this.cacheConsentToPersonUuidRef({
            limit: this.limit,
            skip: this.skip,
            startFromId: this.startFromId,
            mongoConfig
        });

        for (const collection of this.collections) {
            const isHistoryCollection = collection.includes('_History');
            const startFromIdContainer = this.createStartFromIdContainer();
            const query = await this.getQueryForConsent({
                startFromId: this.startFromId,
                isHistoryCollection
            });

            try {
                this.adminLogger.logInfo(
                    `[processAsync] Collection query: ${mongoQueryStringify(
                        query
                    )} for ${collection}`
                );
                const filterToIds = isHistoryCollection ? await this.getUuidsForMainResourceAsync({
                          collectionName: collection.replace('_History', ''),
                          mongoConfig
                      })
                    : undefined;

                await this.runForQueryBatchesAsync({
                    config: mongoConfig,
                    sourceCollectionName: collection,
                    destinationCollectionName: collection,
                    query,
                    startFromIdContainer,
                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordsAsync(
                        {
                            base_version: '4_0_0',
                            requestInfo: this.requestInfo,
                            doc
                        }),
                    ordered: false,
                    batchSize: this.batchSize,
                    skipExistingIds: false,
                    limit: isHistoryCollection ? undefined : this.limit,
                    useTransaction: this.useTransaction,
                    skip: isHistoryCollection ? undefined : this.skip,
                    filterToIds,
                    filterToIdProperty: isHistoryCollection ? 'resource._uuid' : undefined,
                    useEstimatedCount: true
                });
            } catch (error) {
                this.adminLogger.logError(
                    `Got error ${error}.  At ${startFromIdContainer.startFromId}`
                );
                throw new RethrownError({
                    message: `Error processing ids of collection ${collection} ${error.message}`,
                    error,
                    args: {
                        query
                    },
                    source: 'AddProxyPatientToConsentResourceRunner.processAsync'
                });
            } finally {
                this.adminLogger.logInfo(
                    `Consent Resources without Person: ${this.consentWithNoPerson.size}`,
                    {
                        consentWithNoPerson: Object.fromEntries(this.consentWithNoPerson)
                    }
                );

                this.adminLogger.logInfo(
                    `Consent Resources with patient linked to multiple person: ${this.consentToPatientWithMultiplePerson.size}`,
                    {
                        consentToPatientWithMultiplePerson: Object.fromEntries(this.consentToPatientWithMultiplePerson)
                    }
                );
            }
        }
    }

    /**
     * returns the bulk operation for this doc
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {import('mongodb').Document} doc
     * @returns {Promise<import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>[]>}
     */
    async processRecordsAsync ({ base_version, requestInfo, doc }) {
        this.adminLogger.logInfo(`[processRecordsAsync] Processing doc _id: ${doc._id}}`);
        /**
         * @type {boolean}
         */
        const isHistoryDoc = Boolean(doc?.resource);

        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>[]}
         */
        const operations = [];
        /**
         * @type {Resource}
         */
        let resource = FhirResourceCreator.create(isHistoryDoc ? doc.resource : doc);
        /**
         * @type {Resource}
         */
        const currentResource = resource.clone();
        // Update resource references from cache
        resource = await this.addProxyPersonLinkToConsent({ base_version, requestInfo, resource, isHistoryDoc });

        // for speed, first check if the incoming resource is exactly the same
        let updatedResourceJsonInternal = resource.toJSONInternal();
        const currentResourceJsonInternal = currentResource.toJSONInternal();

        if (deepEqual(updatedResourceJsonInternal, currentResourceJsonInternal) === true) {
            return operations;
        }

        if (isHistoryDoc) {
            updatedResourceJsonInternal = { ...doc, resource: updatedResourceJsonInternal };
        }
        /**
         * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>}
         */
        // batch up the calls to update
        const operation = {
            replaceOne: { filter: { _id: doc._id }, replacement: updatedResourceJsonInternal }
        };
        operations.push(operation);
        return operations;
    }

    /**
     * Adds Proxy Person reference in resource.provision.actor array
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resource
     */
    async addProxyPersonLinkToConsent ({ base_version, requestInfo, resource }) {
        const provision = resource.provision;
        if (!provision) {
            return resource;
        }

        let provisionActor;
        if (provision.actor) {
            provisionActor = provision.actor;
        } else {
            // resource.provision.actor set method assigns undefined if empty array is passed. So storing it in provisionActor[]
            provisionActor = [];
        }

        if (!Array.isArray(provisionActor)) {
            return resource;
        }

        // get the person id from the cache
        const immediatePerson = this.consentToImmediatePersonCache.get(resource._uuid);

        if (!immediatePerson) {
            this.adminLogger.logger.warn(
                `No Immediate Person found in cache for consentUuid: '${resource._uuid}'`
            );
            this.consentWithNoPerson.set(resource._uuid, resource.patient._uuid);
            return resource;
        }

        const proxyPatientReference = `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${immediatePerson.id.replace(
            PERSON_REFERENCE_PREFIX,
            ''
        )}`;
        let wrongPersonActor;

        /** @type {boolean} */
        const isAlreadyPresent = provisionActor.some((actor) => {
            let alreadyPresent;
            alreadyPresent =
                actor.reference &&
                actor.reference._uuid &&
                typeof actor.reference._uuid === 'string';

            // check for coding
            alreadyPresent =
                alreadyPresent &&
                actor.role &&
                actor.role.coding &&
                Array.isArray(actor.role.coding) &&
                actor.role.coding.some((coding) => {
                    return coding.code === PROXY_PERSON_CONSENT_CODING.CODE;
                });

            if (alreadyPresent) {
                if (actor.reference._uuid === proxyPatientReference) {
                    this.adminLogger.logger.warn(
                        `[addProxyPersonReference] Proxy Person '${proxyPatientReference}' already present for ${resource._uuid}`
                    );
                } else {
                    wrongPersonActor = actor;
                    this.adminLogger.logger.warn(
                        `[addProxyPersonReference] Wrong Proxy Person '${actor.reference._uuid}' present instead of ${proxyPatientReference} for ${resource._uuid}`
                    );
                }
            }
            return alreadyPresent;
        });

        if (isAlreadyPresent) {
            // proxy-patient reference is already present
            if (wrongPersonActor) {
                wrongPersonActor.reference = {
                    reference: proxyPatientReference,
                    _sourceAssigningAuthority: immediatePerson.sourceAssigningAuthority
                };
                 // call the presave
                 resource = await this.preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
            }

            return resource;
        } else {
            const actor = new ConsentActor({
                role: {
                    coding: [
                        {
                            system: PROXY_PERSON_CONSENT_CODING.SYSTEM,
                            code: PROXY_PERSON_CONSENT_CODING.CODE
                        }
                    ]
                },
                reference: {
                    reference: proxyPatientReference,
                    _sourceAssigningAuthority: immediatePerson.sourceAssigningAuthority
                }
            });

            provisionActor.push(actor);

            // setting the value
            resource.provision.actor = provisionActor;
            // call the presave
            resource = await this.preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
            // add the reference
            return resource;
        }
    }

    /**
     * Fetch list of uuids of main resource for history processing
     * @param {string} collectionName
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @returns {Promise<string>}
     */
    async getUuidsForMainResourceAsync ({ collectionName, mongoConfig }) {
        this.adminLogger.logInfo(`Fetching ${collectionName} _uuids from db`);
        const result = [];
        /**
         * @type {Object}
         */
        const projection = {
            _uuid: 1
        };
        /**
         * @type {import('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = await this.getQueryForConsent({
                isHistoryCollection: false,
                startFromId: this.startFromId
            });

            this.adminLogger.logInfo(
                `[getUuidsForMainResourceAsync] Query generated ${mongoQueryStringify(query)}`
            );
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(query, { projection, session });

            const { limit, skip } = this;
            if (limit) {
                cursor.limit(limit);
            }

            if (skip) {
                cursor.skip(skip);
            }

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                if (doc && doc._uuid) {
                    result.push(doc._uuid);
                }
            }
            this.adminLogger.logInfo(`Successfully fetched ${collectionName} _uuids from db`);
        } catch (e) {
            console.log(e);
            throw new RethrownError({
                message: `Error fetching uuids for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'AddProxyPatientToConsentResourceRunner.getUuidsForMainResource'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
        return result;
    }

    /**
     * Caches consent to person
     * @param {{limit: number; skip: number; mongoConfig: any; startFromId: string | undefined }} params
     */
    async cacheConsentToPersonUuidRef ({ mongoConfig, limit, skip, startFromId }) {
        const collectionName = 'Consent_4_0_0';
        const projection = {
            _id: 1,
            _sourceId: 1,
            _uuid: 1,
            patient: 1
        };

        const query = await this.getQueryForConsent({ startFromId });
        this.adminLogger.logInfo('Starting caching of consent id to bwellPerson map', {
            query,
            limit,
            skip
        });

        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });

        /**
         * @type {Map<string, string>}
         */
        const consentToPatientRefMap = new Map();
        /**
         * @type {import('../../operations/query/filters/searchFilterFromReference').IReferences[]}
         */
        const patientReferences = [];

        try {
            const cursor = await collection
                .find(query, {
                    projection,
                    session
                })
                .sort({ _id: 1 });

            if (limit) {
                cursor.limit(limit);
            }

            if (skip) {
                cursor.skip(skip);
            }

            while (await cursor.hasNext()) {
                const consent = await cursor.next();
                await this.consentCacheHelper({
                    doc: consent,
                    processPatientReference: (consentUuid, patientUuidRef) => {
                        const { id, resourceType } = ReferenceParser.parseReference(patientUuidRef);

                        // we don't need sourceAssigningAuthority as we are searching on basis of uuid
                        patientReferences.push({
                            id,
                            resourceType: resourceType || 'Patient'
                        });
                        consentToPatientRefMap.set(consentUuid, patientUuidRef);
                    }
                });
            }

            // find person
            const { patientReferenceToPersonUuid } = await this.bwellPersonFinder.getImmediatePersonIdsOfPatientsAsync({ patientReferences, asObject: true });

            // build cache
            consentToPatientRefMap.forEach((patientReference, consentId) => {
                // assign person
                const immediatePersons = patientReferenceToPersonUuid[patientReference.replace(PATIENT_REFERENCE_PREFIX, '')];

                if (immediatePersons && immediatePersons.length > 0) {
                    // there will only be one client person for a client patient
                    if (immediatePersons.length > 1) {
                        this.adminLogger.logger.warn(`Multiple persons linked with patient '${patientReference}'`, {
                            consentId,
                            patientReference,
                            immediatePersons
                        });
                        this.consentToPatientWithMultiplePerson.set(consentId, patientReference);
                    } else {
                        this.consentToImmediatePersonCache.set(consentId, immediatePersons[0]);
                    }
                } else {
                    this.adminLogger.logger.warn(
                        `No Person found for consentId '${consentId}' and patientReference: '${patientReference}'.`,
                        {
                            consentId,
                            patientReference
                        }
                    );
                }
            });

            // cache
            this.adminLogger.logInfo(
                `Cached ${this.consentToImmediatePersonCache.size} out of ${consentToPatientRefMap.size} resources`
            );
        } catch (e) {
            console.log(e);
            throw new RethrownError({
                message: `Error caching references for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'AddProxyPatientToConsentResourceRunner.cacheConsentToBwellPersonUuidRef'
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * If null values are present then return else process. Pass the processPatientReference which gets called if uuids are present.
     * @param {import('mongodb').Document} doc
     * @param {(consentId: string, patientId: string) => Promise<void>} processPatientReference
     * @returns {Promise<void>}
     */
    async consentCacheHelper ({ doc, processPatientReference }) {
        if (!doc._uuid) {
            this.adminLogger.logInfo(
                `Uuid is not present for the consent resource with sourceId: ${doc._sourceId}`
            );
            return;
        }

        if (!doc.patient || !doc.patient._uuid) {
            this.adminLogger.logInfo(
                `patient._uuid is not present for the consent resource with uuid: ${doc._uuid}`
            );
            return;
        }

        const uuid = doc._uuid;
        const patientId = doc.patient._uuid;
        await processPatientReference(uuid, patientId);
    }

    /**
     * Builds Query
     * @param {{
     * startFromId: string | undefined;
     * isHistoryCollection: string | undefined;
     * }} options
     * @returns Query
     */
    async getQueryForConsent ({ startFromId, isHistoryCollection }) {
        const query = {};
        const prefix = isHistoryCollection ? 'resource.' : '';
        const properties = ['_uuid', 'patient'];
        query.$and = properties.map((v) => this.filterPropExist(`${prefix}${v}`));

        // add support for lastUpdated
        if (this.beforeLastUpdatedDate && this.afterLastUpdatedDate) {
            query.$and.push({
                [`${prefix}meta.lastUpdated`]: {
                    $lt: this.beforeLastUpdatedDate,
                    $gt: this.afterLastUpdatedDate
                }
            });
        } else if (this.beforeLastUpdatedDate) {
            query.$and.push({
                [`${prefix}meta.lastUpdated`]: {
                    $lt: this.beforeLastUpdatedDate
                }
            });
        } else if (this.afterLastUpdatedDate) {
            query.$and.push({
                [`${prefix}meta.lastUpdated`]: {
                    $gt: this.afterLastUpdatedDate
                }
            });
        }

        if (!isHistoryCollection && startFromId) {
            const startId = isValidMongoObjectId(startFromId) ? new ObjectId(startFromId)
                : startFromId;
            query.$and.push({
                _id: {
                    $gte: startId
                }
            });
        }
        return query;
    }

    filterPropExist (propertyName) {
        return { [propertyName]: { $exists: true } };
    }
}

module.exports = { AddProxyPatientToConsentResourceRunner };
