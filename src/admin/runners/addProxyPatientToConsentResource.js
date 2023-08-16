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
    BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY,
} = require('../../constants');
const ConsentActor = require('../../fhir/classes/4_0_0/backbone_elements/consentActor');

const AvailableCollections = ['Consent_4_0_0', 'Consent_4_0_0_History', 'all'];
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
     * @param {AddProxyPatientToConsentResourceRunnerParams} options
     */
    constructor({
        limit,
        startFromId,
        skip,
        collections,
        bwellPersonFinder,
        preSaveManager,
        useTransaction,
        ...args
    }) {
        super(args);

        /**@type {string[]} */
        if (collections.length === 1 && collections[0] === 'all') {
            this.collections = ['Consent_4_0_0', 'Consent_4_0_0_History'];
        } else {
            this.collections = collections.filter(
                (c) => AvailableCollections.includes(c) && c !== 'all'
            );
        }
        this.skip = skip;
        this.limit = limit;
        this.startFromId = startFromId;
        this.useTransaction = useTransaction;

        /**
         * @type {import('../../utils/bwellPersonFinder').BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;

        /**@type {import('../../preSaveHandlers/preSave').PreSaveManager} */
        this.preSaveManager = preSaveManager;

        /**
         * @type {Map<string, Map<string, string> | Set<string>>}
         */
        this.cache = new Map();

        Object.defineProperty(this, 'consentToMasterPersonCache', {
            enumerable: true,
            get: function () {
                return this.cache.get('consentToMasterPersonCache');
            },
            set(value) {
                this.cache.set('consentToMasterPersonCache', value);
            },
        });

        Object.defineProperty(this, 'consentWithNoBwellPerson', {
            enumerable: true,
            get: function () {
                return this.cache.get('consentWithNoBwellPerson');
            },
            set(value) {
                this.cache.set('consentWithNoBwellPerson', value);
            },
        });

        // set the consentToMasterPersonCache
        /**@type {Map<string, string>} */
        this.consentToMasterPersonCache = new Map();

        /**@type {Map<string, string>} */
        this.consentWithNoBwellPerson = new Map();

        this.adminLogger.logInfo('Args', { limit, startFromId, skip, collections });
    }

    /**
     * Runs a loop to process records async
     * @returns {Promise<void>}
     */
    async processAsync() {
        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
        // preload the consentToMasterPerson Map
        await this.cacheConsentToBwellPersonUuidRef({
            limit: this.limit,
            skip: this.skip,
            startFromId: this.startFromId,
            mongoConfig,
        });

        for (const collection of this.collections) {
            const isHistoryCollection = collection.includes('_History');
            const startFromIdContainer = this.createStartFromIdContainer();
            const query = await this.getQueryForConsent({
                startFromId: this.startFromId,
                isHistoryCollection,
            });
            try {
                this.adminLogger.logInfo(
                    `[processAsync] Collection query: ${mongoQueryStringify(
                        query
                    )} for ${collection}`
                );
                const filterToIds = isHistoryCollection ? await this.getUuidsForMainResourceAsync({
                          collectionName: collection.replace('_History', ''),
                          mongoConfig,
                      })
                    : undefined;

                await this.runForQueryBatchesAsync({
                    config: mongoConfig,
                    sourceCollectionName: collection,
                    destinationCollectionName: collection,
                    query,
                    startFromIdContainer,
                    fnCreateBulkOperationAsync: async (doc) => await this.processRecordsAsync(doc),
                    ordered: false,
                    batchSize: this.batchSize,
                    skipExistingIds: false,
                    limit: !isHistoryCollection ? this.limit : undefined,
                    useTransaction: this.useTransaction,
                    skip: !isHistoryCollection ? this.skip : undefined,
                    filterToIds,
                    filterToIdProperty: isHistoryCollection ? 'resource._uuid' : undefined,
                    useEstimatedCount: true,
                });
            } catch (error) {
                this.adminLogger.logError(
                    `Got error ${error}.  At ${startFromIdContainer.startFromId}`
                );
                throw new RethrownError({
                    message: `Error processing ids of collection ${collection} ${error.message}`,
                    error,
                    args: {
                        query,
                    },
                    source: 'AddProxyPatientToConsentResourceRunner.processAsync',
                });
            } finally {
                this.adminLogger.logInfo(
                    `Consent Resources without bwellPerson: ${this.consentWithNoBwellPerson.size}`,
                    {
                        consentWithNoBwellPerson: Object.fromEntries(this.consentWithNoBwellPerson),
                    }
                );
            }
        }
    }

    /**
     * returns the bulk operation for this doc
     * @param {import('mongodb').Document} doc
     * @returns {Promise<Operations[]>}
     */
    async processRecordsAsync(doc) {
        this.adminLogger.logInfo(`[processRecordsAsync] Processing doc _id: ${doc._id}}`);
        /**
         * @type {boolean}
         */
        const isHistoryDoc = Boolean(doc?.resource);

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
        resource = await this.addProxyPersonLinkToConsent({ resource, isHistoryDoc });

        // for speed, first check if the incoming resource is exactly the same
        let updatedResourceJsonInternal = resource.toJSONInternal();
        let currentResourceJsonInternal = currentResource.toJSONInternal();

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
            replaceOne: { filter: { _id: doc._id }, replacement: updatedResourceJsonInternal },
        };
        operations.push(operation);
        return operations;
    }

    /**
     * Adds Proxy Person reference in resource.provision.actor array
     * @param {{ resource: Resource, isHistoryDoc: boolean}} options
     */
    async addProxyPersonLinkToConsent({ resource }) {
        const provision = resource.provision;
        if (!provision) {
            return resource;
        }

        let provisionActor;
        if (!provision.actor) {
            // resource.provision.actor set method assigns undefined if empty array is passed. So storing it in provisionActor[]
            provisionActor = [];
        } else {
            provisionActor = provision.actor;
        }

        if (!Array.isArray(provisionActor)) {
            return resource;
        }

        // get the bwellPerson id from the cache
        const personId = this.consentToMasterPersonCache.get(resource._uuid);
        if (!personId) {
            this.adminLogger.logger.warn(
                `No bwell Person found in cache for consentUuid: '${resource._uuid}'`
            );

            // add to the set
            this.consentWithNoBwellPerson.set(resource._uuid, resource.patient._uuid);
            return resource;
        }

        const proxyPatientReference = `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${personId.replace(
            PERSON_REFERENCE_PREFIX,
            ''
        )}`;
        /**@type {boolean} */
        const isAlreadyPresent = provisionActor.some(
            (actor) =>
                actor.reference &&
                actor.reference._uuid &&
                typeof actor.reference._uuid === 'string' &&
                actor.reference._uuid === proxyPatientReference
        );

        if (isAlreadyPresent) {
            // proxy-patient reference is already present
            return resource;
        } else {
            const actor = new ConsentActor({
                role: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/3.1.0/CodeSystem-v3-RoleCode.html',
                            code: 'AUT',
                        },
                    ],
                },
                reference: {
                    reference: proxyPatientReference,
                    _sourceAssigningAuthority: BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY,
                },
            });

            provisionActor.push(actor);

            // setting the value
            resource.provision.actor = provisionActor;
            // call the presave
            resource = await this.preSaveManager.preSaveAsync(resource);
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
    async getUuidsForMainResourceAsync({ collectionName, mongoConfig }) {
        this.adminLogger.logInfo(`Fetching ${collectionName} _uuids from db`);
        let result = [];
        /**
         * @type {Object}
         */
        let projection = {
            _uuid: 1,
        };
        /**
         * @type {require('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName,
        });

        try {
            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = await this.getQueryForConsent({
                isHistoryCollection: false,
                startFromId: this.startFromId,
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
                source: 'AddProxyPatientToConsentResourceRunner.getUuidsForMainResource',
            });
        } finally {
            await session.endSession();
            await client.close();
        }
        return result;
    }

    /**
     * Creates a single connection and returns the collection instance
     * @param {{limit: number; skip: number; mongoConfig: any; startFromId: string | undefined }} params
     */
    async cacheConsentToBwellPersonUuidRef({ mongoConfig, limit, skip, startFromId }) {
        const collectionName = 'Consent_4_0_0';
        let projection = {
            _id: 1,
            _sourceId: 1,
            _uuid: 1,
            patient: 1,
        };

        const query = await this.getQueryForConsent({ startFromId });
        this.adminLogger.logInfo('Starting caching of consent id to bwellPerson map', {
            query,
            limit,
            skip,
        });

        const { collection, session, client } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName,
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
                    session,
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
                            resourceType: resourceType || 'Patient',
                        });
                        consentToPatientRefMap.set(consentUuid, patientUuidRef);
                    },
                });
            }

            // for all patients, find the bwellPerson
            const patientToPersonMap = await this.bwellPersonFinder.getBwellPersonIdsAsync({
                patientReferences,
            });

            // build cache
            consentToPatientRefMap.forEach((patientReference, consentId) => {
                const bwellPersonUuidRef = patientToPersonMap.get(patientReference);
                if (!bwellPersonUuidRef) {
                    this.adminLogger.logger.warn(
                        `No bwell Person found for consentId '${consentId}' and patientReference: '${patientReference}'.`,
                        {
                            consentId,
                            patientReference,
                        }
                    );
                    return;
                }

                this.consentToMasterPersonCache?.set(consentId, bwellPersonUuidRef);
            });

            // cache
            this.adminLogger.logInfo(
                `Cached ${this.consentToMasterPersonCache.size} out of ${consentToPatientRefMap.size} resources`
            );
        } catch (e) {
            console.log(e);
            throw new RethrownError({
                message: `Error caching references for collection ${collectionName}, ${e.message}`,
                error: e,
                source: 'AddProxyPatientToConsentResourceRunner.cacheConsentToBwellPersonUuidRef',
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * If null values are present then return else process. Pass the processPatientReference which gets called if uuids are present.
     * @param {{ doc: import('mongodb').Document, processPatientReference: (consentId: string, patientId: string): Promise<void>}} params
     */
    async consentCacheHelper({ doc, processPatientReference }) {
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
        processPatientReference(uuid, patientId);
    }

    /**
     * Builds Query
     * @param {{
     * startFromId: string | undefined;
     * isHistoryCollection: string | undefined;
     * }} options
     * @returns Query
     */
    async getQueryForConsent({ startFromId, isHistoryCollection }) {
        let query = {};
        const prefix = isHistoryCollection ? 'resource.' : '';
        const properties = ['_uuid', 'patient'];
        query.$and = properties.map((v) => this.filterPropExist(`${prefix}${v}`));

        if (!isHistoryCollection && startFromId) {
            const startId = isValidMongoObjectId(startFromId) ? new ObjectId(startFromId)
                : startFromId;
            query.$and.push({
                _id: {
                    $gte: startId,
                },
            });
        }
        return query;
    }

    filterPropExist(propertyName) {
        return { [propertyName]: { $exists: true } };
    }
}

module.exports = { AddProxyPatientToConsentResourceRunner };
