const {assertTypeEquals} = require('../utils/assertType');
const {EverythingOperation} = require('../operations/everything/everything');
const {FhirOperationsManager} = require('../operations/fhirOperationsManager');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {DatabaseUpdateFactory} = require('../dataLayer/databaseUpdateFactory');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const Person = require('../fhir/classes/4_0_0/resources/person');
const BundleSearch = require('../fhir/classes/4_0_0/backbone_elements/bundleSearch');

const base_version = '4_0_0';

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
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        requestInfo.method = 'DELETE';
        const bundle = await this.everythingOperation.everything(requestInfo, {
            'base_version': base_version,
            'id': patientId
        }, 'Patient');
        // now also remove any connections to this Patient record
        /**
         * @type {BundleEntry[]}
         */
        const bundleEntries = await this.removeLinksFromOtherPersonsAsync({bundle});
        bundleEntries.forEach(e => bundle.entry.push(e));
        return bundle;
    }

    /**
     * @description Removes links from other Person records pointing to the resources in this bundle
     * @param {Bundle} bundle
     * @return {Promise<BundleEntry[]>}
     */
    async removeLinksFromOtherPersonsAsync({bundle}) {
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManagerForPerson = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        /**
         * @type {DatabaseUpdateManager}
         */
        const databaseUpdateManagerForPerson = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        /**
         * @type {BundleEntry[]}
         */
        let updatedRecords = [];
        updatedRecords = updatedRecords.concat(
            await this.removeLinksToResourceTypeAsync(
                {
                    bundle, resourceType: 'Patient', databaseQueryManagerForPerson, databaseUpdateManagerForPerson
                })
        );
        updatedRecords = updatedRecords.concat(
            await this.removeLinksToResourceTypeAsync({
                bundle, resourceType: 'Person', databaseQueryManagerForPerson, databaseUpdateManagerForPerson
            })
        );
        return updatedRecords;
    }

    /**
     * Removes link from Person to the resources in the bundle of resourceType
     * @param {Bundle} bundle
     * @param {string} resourceType
     * @param {DatabaseQueryManager} databaseQueryManagerForPerson
     * @param {DatabaseUpdateManager} databaseUpdateManagerForPerson
     * @return {Promise<BundleEntry[]>}
     */
    async removeLinksToResourceTypeAsync(
        {
            bundle,
            resourceType,
            databaseQueryManagerForPerson,
            databaseUpdateManagerForPerson
        }
    ) {
        /**
         * @type {BundleEntry[]}
         */
        const updatedRecords = [];
        /**
         * @type {string[]}
         */
        const deletedResourceIds = bundle.entry.filter(e => e.resource.resourceType === resourceType).map(e => e.resource.id);
        for (const deletedResourceId of deletedResourceIds) {
            /**
             * @type {DatabasePartitionedCursor}
             */
            const personRecordsWithLinkToDeletedResourceIdCursor = await databaseQueryManagerForPerson.findAsync({
                query: {
                    'link.target.reference': `${resourceType}/${deletedResourceId}`
                }
            });
            /**
             * @type {Person[]}
             */
            const personRecordsWithLinkToDeletedResourceId = await personRecordsWithLinkToDeletedResourceIdCursor.toArrayAsync();
            for (const /** @type {Person} */ person of personRecordsWithLinkToDeletedResourceId) {
                person.link = person.link.filter(l => l.target.reference !== `${resourceType}/${deletedResourceId}`);
                await databaseUpdateManagerForPerson.replaceOneAsync({
                    doc: person
                });
                updatedRecords.push(
                    new BundleEntry(
                        {
                            resource: new Person(
                                {
                                    id: person.id,
                                }
                            ),
                            search: new BundleSearch(
                                {
                                    mode: 'include'
                                }
                            )
                        }
                    )
                );
            }
        }
        return updatedRecords;
    }

    /**
     * @description deletes the person data graph
     * @param {import('http').IncomingMessage} req
     * @param {string} personId
     * @return {Promise<Bundle>}
     */
    async deletePersonDataGraphAsync({req, personId}) {
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        requestInfo.method = 'DELETE';
        const bundle = await this.everythingOperation.everything(requestInfo, {
            'base_version': base_version,
            'id': personId
        }, 'Person');
        // now also remove any connections to this Patient record
        /**
         * @type {BundleEntry[]}
         */
        const bundleEntries = await this.removeLinksFromOtherPersonsAsync({bundle});
        bundleEntries.forEach(e => bundle.entry.push(e));
        return bundle;

    }
}

module.exports = {
    AdminPersonPatientDataManager
};
