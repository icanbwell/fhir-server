const { assertTypeEquals } = require('../utils/assertType');
const { EverythingOperation } = require('../operations/everything/everything');
const { FhirOperationsManager } = require('../operations/fhirOperationsManager');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { AdminResourceWriter } = require('./adminResourceWriter');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { RethrownError } = require('../utils/rethrownError');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { DatabaseQueryManager } = require('../dataLayer/databaseQueryManager');
const { FhirResourceWriteSerializer } = require('../fhir/fhirResourceWriteSerializer');
const { FhirResourceSerializer } = require('../fhir/fhirResourceSerializer');
const BundleSerializer = require('../fhir/serializers/4_0_0/resources/bundle');
const { buildBundleEntry } = require('../utils/bundleEntryBuilder');

const base_version = VERSIONS['4_0_0'];

class AdminPersonPatientDataManager {
    /**
     * constructor
     * @param {FhirOperationsManager} fhirOperationsManager
     * @param {EverythingOperation} everythingOperation
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {R4ArgsParser} r4ArgsParser
     * @param {AdminResourceWriter} adminResourceWriter
     */
    constructor (
        {
            fhirOperationsManager,
            everythingOperation,
            databaseQueryFactory,
            adminResourceWriter,
            r4ArgsParser
        }
    ) {
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
        /**
         * @type {EverythingOperation}
         */
        this.everythingOperation = everythingOperation;
        assertTypeEquals(everythingOperation, EverythingOperation);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {AdminResourceWriter}
         */
        this.adminResourceWriter = adminResourceWriter;
        assertTypeEquals(adminResourceWriter, AdminResourceWriter);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
    }

    /**
     * @description Deletes the patient data graph
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @param {string} patientId
     * @param {BaseResponseStreamer} responseStreamer
     * @param {string|undefined} [method]
     * @return {Promise<Bundle>}
     */
    async deletePatientDataGraphAsync ({ req, res, patientId, responseStreamer, method = 'DELETE' }) {
        try {
            const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
            requestInfo.method = method;
            const args = {
                base_version,
                id: patientId
            };
            const bundle = await this.everythingOperation.everythingAsync({
                requestInfo,
                res,
                resourceType: 'Patient',
                parsedArgs: this.r4ArgsParser.parseArgs({ resourceType: 'Patient', args }),
                responseStreamer: null
            });
            if (method === 'DELETE') {
                // now also remove any connections to this Patient record
                /**
                 * @type {BundleEntry[]}
                 */
                const bundleEntries = await this.removeLinksFromOtherPersonsAsync({
                    base_version,
                    requestInfo,
                    bundle,
                    responseStreamer: null
                });
                bundleEntries.forEach(e => bundle.entry.push(e));
            }
            bundle.entry?.forEach(bundleEntry => responseStreamer?.writeBundleEntryAsync({ bundleEntry }));
            return responseStreamer ? bundle : FhirResourceSerializer.serialize(bundle, BundleSerializer);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deletePatientDataGraphAsync(): ', error: e
            });
        }
    }

    /**
     * @description Removes links from other Person records pointing to the resources in this bundle
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {BaseResponseStreamer} responseStreamer
     * @param {Bundle} bundle
     * @return {Promise<BundleEntry[]>}
     */
    async removeLinksFromOtherPersonsAsync ({ base_version, requestInfo, responseStreamer, bundle }) {
        try {
            /**
             * @type {DatabaseQueryManager}
             */
            const databaseQueryManagerForPerson = this.databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version
            });
            /**
             * @type {BundleEntry[]}
             */
            let updatedRecords = [];
            updatedRecords = updatedRecords.concat(
                await this.removeLinksToResourceTypeAsync(
                    {
                        base_version,
                        requestInfo,
                        bundle,
                        resourceType: 'Patient',
                        databaseQueryManagerForPerson,
                        responseStreamer
                    })
            );
            updatedRecords = updatedRecords.concat(
                await this.removeLinksToResourceTypeAsync({
                    base_version,
                    requestInfo,
                    bundle,
                    resourceType: 'Person',
                    databaseQueryManagerForPerson,
                    responseStreamer
                })
            );
            return updatedRecords;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in removeLinksFromOtherPersonsAsync(): ', error: e
            });
        }
    }

    /**
     * @description deletes the person data graph
     * @param {import('http').IncomingMessage} req
     * @param {import('http').ServerResponse} res
     * @param {string} personId
     * @param {BaseResponseStreamer} responseStreamer
     * @param {string|undefined} [method]
     * @return {Promise<Bundle>}
     */
    async deletePersonDataGraphAsync ({ req, res, personId, responseStreamer, method = 'DELETE' }) {
        try {
            const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
            requestInfo.method = method;
            const args = {
                base_version,
                id: personId
            };
            const bundle = await this.everythingOperation.everythingAsync({
                requestInfo,
                res,
                resourceType: 'Person',
                parsedArgs: this.r4ArgsParser.parseArgs({ resourceType: 'Person', args }),
                responseStreamer: null
            });
            if (method === 'DELETE') {
                // now also remove any connections to this Patient record
                /**
                 * @type {BundleEntry[]}
                 */
                const bundleEntries = await this.removeLinksFromOtherPersonsAsync({
                    base_version,
                    requestInfo,
                    responseStreamer: null,
                    bundle
                });
                bundleEntries.forEach(e => bundle.entry.push(e));
            }
            bundle.entry?.forEach(bundleEntry => responseStreamer?.writeBundleEntryAsync({ bundleEntry }));
            return responseStreamer ? bundle : FhirResourceSerializer.serialize(bundle, BundleSerializer);
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deletePersonDataGraphAsync(): ' + `person id:${personId}, `, error: e
            });
        }
    }

    /**
     * Removes link from Person to the resources in the bundle of resourceType
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Bundle} bundle
     * @param {string} resourceType
     * @param {DatabaseQueryManager} databaseQueryManagerForPerson
     * @param {BaseResponseStreamer} responseStreamer
     * @return {Promise<BundleEntry[]>}
     */
    async removeLinksToResourceTypeAsync (
        {
            base_version,
            requestInfo,
            bundle,
            resourceType,
            databaseQueryManagerForPerson,
            responseStreamer
        }
    ) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        assertTypeEquals(databaseQueryManagerForPerson, DatabaseQueryManager);
        const requestId = requestInfo.requestId;
        if (!bundle.entry) {
            return [];
        }
        try {
            /**
             * @type {BundleEntry[]}
             */
            const updatedRecords = [];
            /**
             * @type {string[]}
             */
            const deletedResourceIds = bundle.entry.filter(e => e.resource.resourceType === resourceType).map(e => e.resource._uuid);
            if (deletedResourceIds && deletedResourceIds.length > 0) {
                /**
                 * @type {string[]}
                 */
                const deletedResourceIdsWithResourceType = deletedResourceIds.map(deletedResourceId => `${resourceType}/${deletedResourceId}`);
                /**
                 * @type {import('../dataLayer/databaseCursor').DatabaseCursor}
                 */
                const personRecordsWithLinkToDeletedResourceIdCursor = await databaseQueryManagerForPerson.findAsync({
                    query: { 'link.target._uuid': { $in: deletedResourceIdsWithResourceType } }
                });
                /**
                 * @type {import('mongodb').DefaultSchema[]}
                 */
                const personRecordsWithLinkToDeletedResourceId = await personRecordsWithLinkToDeletedResourceIdCursor.toArrayAsync();
                for (
                    const /** @type {import('mongodb').DefaultSchema} */
                    personRecordWithLinkToDeletedResourceId of personRecordsWithLinkToDeletedResourceId
                ) {
                    /**
                     * @type {Object}
                     */
                    const person = FhirResourceWriteSerializer.serializeByResourceType({
                        obj: personRecordWithLinkToDeletedResourceId,
                        resourceType: 'Person'
                    });
                    person.link = person.link.filter(l => !deletedResourceIdsWithResourceType.includes(l.target._uuid));
                    await this.adminResourceWriter.writeAsync({
                        requestInfo,
                        base_version,
                        resourceType: 'Person',
                        resource: person,
                        smartMerge: false
                    });
                    const bundleEntry = buildBundleEntry({
                        id: person.id,
                        resource: {
                            resourceType: 'Person',
                            id: person.id
                        },
                        request: {
                            id: requestId,
                            method: 'PATCH',
                            url: `/${base_version}/Person/${person.id}`
                        }
                    });
                    if (responseStreamer) {
                        await responseStreamer.writeBundleEntryAsync({
                            bundleEntry
                        });
                    } else {
                        updatedRecords.push(
                            bundleEntry
                        );
                    }
                }
            }
            return updatedRecords;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in removeLinksToResourceTypeAsync(): ', error: e
            });
        }
    }
}

module.exports = {
    AdminPersonPatientDataManager
};
