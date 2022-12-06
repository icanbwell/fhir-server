const {assertTypeEquals} = require('../utils/assertType');
const {EverythingOperation} = require('../operations/everything/everything');
const {FhirOperationsManager} = require('../operations/fhirOperationsManager');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {DatabaseUpdateFactory} = require('../dataLayer/databaseUpdateFactory');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const Person = require('../fhir/classes/4_0_0/resources/person');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const {VERSIONS} = require('../middleware/fhir/utils/constants');
const {RethrownError} = require('../utils/rethrownError');

const base_version = VERSIONS['4_0_0'];

class AdminPersonPatientDataManager {

    /**
     * constructor
     * @param {FhirOperationsManager} fhirOperationsManager
     * @param {EverythingOperation} everythingOperation
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     */
    constructor(
        {
            fhirOperationsManager,
            everythingOperation,
            databaseQueryFactory,
            databaseUpdateFactory
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
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);
    }

    /**
     * @description Deletes the patient data graph
     * @param {import('http').IncomingMessage} req
     * @param {string} patientId
     * @return {Promise<Bundle>}
     */
    async deletePatientDataGraphAsync({req, patientId}) {
        try {
            const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
            requestInfo.method = 'DELETE';
            const bundle = await this.everythingOperation.everything({
                requestInfo,
                args: {
                    'base_version': base_version,
                    'id': patientId
                },
                resourceType: 'Patient',
                streamResponse: false
            });
            // now also remove any connections to this Patient record
            /**
             * @type {BundleEntry[]}
             */
            const bundleEntries = await this.removeLinksFromOtherPersonsAsync({
                requestId: req.id,
                bundle
            });
            bundleEntries.forEach(e => bundle.entry.push(e));
            return bundle;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deletePatientDataGraphAsync(): ', error: e
            });
        }
    }

    /**
     * @description Removes links from other Person records pointing to the resources in this bundle
     * @param {string} requestId
     * @param {Bundle} bundle
     * @return {Promise<BundleEntry[]>}
     */
    async removeLinksFromOtherPersonsAsync({requestId, bundle}) {
        try {
            /**
             * @type {DatabaseQueryManager}
             */
            const databaseQueryManagerForPerson = this.databaseQueryFactory.createQuery({
                resourceType: 'Person',
                base_version: base_version
            });
            /**
             * @type {DatabaseUpdateManager}
             */
            const databaseUpdateManagerForPerson = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Person',
                base_version: base_version
            });
            /**
             * @type {BundleEntry[]}
             */
            let updatedRecords = [];
            updatedRecords = updatedRecords.concat(
                await this.removeLinksToResourceTypeAsync(
                    {
                        requestId,
                        bundle, resourceType: 'Patient', databaseQueryManagerForPerson, databaseUpdateManagerForPerson
                    })
            );
            updatedRecords = updatedRecords.concat(
                await this.removeLinksToResourceTypeAsync({
                    requestId,
                    bundle, resourceType: 'Person', databaseQueryManagerForPerson, databaseUpdateManagerForPerson
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
     * @return {Promise<Bundle>}
     */
    async deletePersonDataGraphAsync({req, res, personId}) {
        try {
            const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
            requestInfo.method = 'DELETE';
            const bundle = await this.everythingOperation.everything({
                requestInfo,
                res,
                args: {
                    'base_version': base_version,
                    'id': personId
                }, resourceType: 'Person',
                streamResponse: false
            });
            // now also remove any connections to this Patient record
            /**
             * @type {BundleEntry[]}
             */
            const bundleEntries = await this.removeLinksFromOtherPersonsAsync({
                requestId: req.id,
                bundle
            });
            bundleEntries.forEach(e => bundle.entry.push(e));
            return bundle;
        } catch (e) {
            throw new RethrownError({
                message: 'Error in deletePersonDataGraphAsync(): ' + `person id:${personId}, `, error: e
            });
        }
    }

    /**
     * Removes link from Person to the resources in the bundle of resourceType
     * @param {string} requestId
     * @param {Bundle} bundle
     * @param {string} resourceType
     * @param {DatabaseQueryManager} databaseQueryManagerForPerson
     * @param {DatabaseUpdateManager} databaseUpdateManagerForPerson
     * @return {Promise<BundleEntry[]>}
     */
    async removeLinksToResourceTypeAsync(
        {
            requestId,
            bundle,
            resourceType,
            databaseQueryManagerForPerson,
            databaseUpdateManagerForPerson
        }
    ) {
        try {
            /**
             * @type {BundleEntry[]}
             */
            const updatedRecords = [];
            /**
             * @type {string[]}
             */
            const deletedResourceIds = bundle.entry.filter(e => e.resource.resourceType === resourceType).map(e => e.resource.id);
            if (deletedResourceIds && deletedResourceIds.length > 0) {
                /**
                 * @type {string[]}
                 */
                const deletedResourceIdsWithResourceType = deletedResourceIds.map(deletedResourceId => `${resourceType}/${deletedResourceId}`);
                /**
                 * @type {DatabasePartitionedCursor}
                 */
                const personRecordsWithLinkToDeletedResourceIdCursor = await databaseQueryManagerForPerson.findAsync({
                    query: {
                        'link.target.reference': {'$in': deletedResourceIdsWithResourceType}
                    }
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
                     * @type {Person}
                     */
                    const person = new Person(personRecordWithLinkToDeletedResourceId);
                    person.link = person.link.filter(l => !deletedResourceIdsWithResourceType.includes(l.target.reference));
                    await databaseUpdateManagerForPerson.replaceOneAsync({
                        doc: person
                    });
                    updatedRecords.push(
                        new BundleEntry(
                            {
                                id: person.id,
                                resource: new Person(
                                    {
                                        id: person.id,
                                    }
                                ),
                                request: new BundleRequest(
                                    {
                                        id: requestId,
                                        method: 'PATCH',
                                        url: `/${base_version}/Person/${person.id}`
                                    }
                                )
                            }
                        )
                    );
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
