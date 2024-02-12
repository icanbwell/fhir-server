const {assertTypeEquals} = require('../utils/assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const {DatabaseUpdateFactory} = require('../dataLayer/databaseUpdateFactory');
const Person = require('../fhir/classes/4_0_0/resources/person');
const {FhirOperationsManager} = require('../operations/fhirOperationsManager');
const {generateUUID, isUuid} = require('../utils/uid.util');
const moment = require('moment-timezone');
const {SecurityTagSystem} = require('../utils/securityTagSystem');
const PersonLink = require('../fhir/classes/4_0_0/backbone_elements/personLink');
const {VERSIONS} = require('../middleware/fhir/utils/constants');
const {logInfo} = require('../operations/common/logging');

const maximumRecursionDepth = 5;
const patientReferencePrefix = 'Patient/';
const personReferencePrefix = 'Person/';

const base_version = VERSIONS['4_0_0'];

class AdminPersonPatientLinkManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     * @param {FhirOperationsManager} fhirOperationsManager
     */
    constructor(
        {
            databaseQueryFactory,
            databaseUpdateFactory,
            fhirOperationsManager
        }
    ) {
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

        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
    }

    /**
     * creates a person to person link
     * @param {request} req
     * @param {string} bwellPersonId
     * @param {string} externalPersonId
     * @return {Promise<Object>}
     */
    async createPersonToPersonLinkAsync({req, bwellPersonId, externalPersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        externalPersonId = externalPersonId.replace('Person/', '');
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Person',
            base_version: base_version
        });
        let requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        const {
            requestId,
            method
        } = requestInfo;

        /**
         * @type {Person}
         */
        const bwellPerson = await databaseQueryManager.findOneAsync({
            query: {id: bwellPersonId}
        });
        if (bwellPerson) {
            if (bwellPerson.link) {
                // check if a link target already exists in bwellPerson for externalPersonId
                if (!bwellPerson.link.some(l => l.target && l.target.reference === `Person/${externalPersonId}`)) {
                    logInfo('link before (non-empty)', {'link': bwellPerson.link});
                    bwellPerson.link = bwellPerson.link.concat([
                        new PersonLink(
                            {
                                target: new Reference(
                                    {reference: `Person/${externalPersonId}`}
                                )
                            })
                    ]);
                    logInfo('link after (non-empty)', {'link': bwellPerson.link});
                } else {
                    return {
                        'message': `Link already exists from ${bwellPersonId} to ${externalPersonId}`,
                        'bwellPersonId': bwellPersonId,
                        'externalPersonId': externalPersonId
                    };
                }
            } else {
                // no existing link array so create one
                logInfo('link before (empty)', {'link': bwellPerson.link});
                bwellPerson.link = [new PersonLink(
                    {
                        target: new Reference(
                            {reference: `Person/${externalPersonId}`}
                        )
                    })];
                logInfo('link after (empty)', {'link': bwellPerson.link});
            }
            // eslint-disable-next-line no-unused-vars
            const {savedResource, patches} = await databaseUpdateManager.replaceOneAsync({
                doc: bwellPerson
            });

            await databaseUpdateManager.postSaveAsync({
                requestId: requestId,
                method: method,
                doc: savedResource
            });

            return {
                'message': `Added link from Person/${bwellPersonId} to Person/${externalPersonId}`,
                'bwellPersonId': bwellPersonId,
                'externalPersonId': externalPersonId
            };
        } else {
            return {
                'message': `No Person found with id ${bwellPersonId}`,
                'bwellPersonId': bwellPersonId,
                'externalPersonId': externalPersonId
            };
        }
    }

    /**
     * removes a person to person link
     * @param {request} req
     * @param {string} bwellPersonId
     * @param {string} externalPersonId
     * @return {Promise<Object>}
     */
    async removePersonToPersonLinkAsync({req, bwellPersonId, externalPersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        externalPersonId = externalPersonId.replace('Person/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        let requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        const {
            requestId,
            method
        } = requestInfo;
        /**
         * @type {Person}
         */
        const bwellPerson = await databaseQueryManager.findOneAsync({
            query: {id: bwellPersonId}
        });
        if (bwellPerson) {
            if (bwellPerson.link) {
                // check if a link target already exists in bwellPerson for externalPersonId
                if (!bwellPerson.link.some(l => l.target && l.target.reference === `Person/${externalPersonId}`)) {
                    return {
                        'message': `No Link exists from Person/${bwellPersonId} to Person/${externalPersonId}`,
                        'bwellPersonId': bwellPersonId,
                        'externalPersonId': externalPersonId
                    };
                } else {
                    logInfo('link before', {'link': bwellPerson.link});
                    bwellPerson.link = bwellPerson.link.filter(l => (l.target.reference !== `Person/${externalPersonId}`));
                    logInfo('link after', {'link': bwellPerson.link});
                }
            } else {
                return {
                    'message': `No Link exists from Person/${bwellPersonId} to Person/${externalPersonId}`,
                    'bwellPersonId': bwellPersonId,
                    'externalPersonId': externalPersonId
                };
            }
            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Person',
                base_version: base_version
            });
            // eslint-disable-next-line no-unused-vars
            const {savedResource, patches} = await databaseUpdateManager.replaceOneAsync({
                doc: bwellPerson,
                smartMerge: false,
            });

            await databaseUpdateManager.postSaveAsync({
                requestId: requestId,
                method: method,
                doc: savedResource
            });

            return {
                'message': `Removed link from Person/${bwellPersonId} to Person/${externalPersonId}`,
                'bwellPersonId': bwellPersonId,
                'externalPersonId': externalPersonId
            };
        } else {
            return {
                'message': `No Person found with id ${bwellPersonId}`,
                'bwellPersonId': bwellPersonId,
                'externalPersonId': externalPersonId
            };
        }
    }

    /**
     * creates a person to patient link
     * @param {request} req
     * @param {string} externalPersonId
     * @param {string} patientId
     * @return {Promise<Object>}
     */
    async createPersonToPatientLinkAsync({req, externalPersonId, patientId}) {
        externalPersonId = externalPersonId.replace('Person/', '');
        patientId = patientId.replace('Patient/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Person',
            base_version: base_version
        });
        let requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        const {
            requestId,
            method
        } = requestInfo;

        /**
         * @type {Person}
         */
        let sourcePerson = await databaseQueryManager.findOneAsync({
            query: { [isUuid(externalPersonId) ? '_uuid' : 'id']: externalPersonId}
        });
        if (!sourcePerson) {
            // create it
            // first read the meta tags from the patient
            const patientDatabaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Patient',
                base_version: base_version
            });
            /**
             * @type {Patient|null}
             */
            const patient = await patientDatabaseQueryManager.findOneAsync({
                query: {[isUuid(patientId) ? '_uuid' : 'id']: patientId}
            });
            if (!patient) {
                return {
                    'message': `No Patient found for id: ${patientId}`,
                    'patientId': patientId,
                    'externalPersonId': externalPersonId
                };
            }
            /**
             * @type {Meta}
             */
            const meta = patient.meta;
            sourcePerson = new Person({
                'id': generateUUID(),
                'meta': {
                    'id': generateUUID(),
                    'versionId': 1,
                    'lastUpdated': new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
                    'source': meta.source,
                    'security': meta.security
                },
                'link': [
                    new PersonLink(
                        {
                            target: new Reference({reference: `Patient/${patientId}`}
                            )
                        })
                ]
            });
            const savedResource = await databaseUpdateManager.insertOneAsync({doc: sourcePerson});

            await databaseUpdateManager.postSaveAsync({
                requestId: requestId,
                method: method,
                doc: savedResource
            });

            return {
                'message': `Created Person and added link from Person/${externalPersonId} to Patient/${patientId}`,
                'patientId': patientId,
                'externalPersonId': externalPersonId
            };
        } else {
            if (sourcePerson.link) {
                // check if a link target already exists in sourcePerson for externalPersonId
                if (!sourcePerson.link.some(l => l.target && l.target.reference === `Patient/${patientId}`)) {
                    logInfo('link before (non-empty)', {'link': sourcePerson.link});
                    sourcePerson.link = sourcePerson.link.concat([
                        new PersonLink(
                            {
                                target: new Reference({reference: `Patient/${patientId}`}
                                )
                            })
                    ]);
                    logInfo('link before (non-empty)', {'link': sourcePerson.link});
                } else {
                    return {
                        'message': `Link already exists from Person/${externalPersonId} to Patient/${patientId}`,
                        'patientId': patientId,
                        'externalPersonId': externalPersonId
                    };
                }
            } else {
                logInfo('link before (empty)', {'link': sourcePerson.link});
                sourcePerson.link = [
                    new PersonLink(
                        {
                            target: new Reference(
                                {reference: `Patient/${patientId}`}
                            )
                        })];
                logInfo('link after', {'link': sourcePerson.link});
            }
            // eslint-disable-next-line no-unused-vars
            const {savedResource, patches} = await databaseUpdateManager.replaceOneAsync({
                doc: sourcePerson
            });

            await databaseUpdateManager.postSaveAsync({
                requestId: requestId,
                method: method,
                doc: savedResource
            });

            return {
                'message': `Added link from Person/${externalPersonId} to Patient/${patientId}`,
                'patientId': patientId,
                'externalPersonId': externalPersonId
            };
        }
    }

    /**
     * recursively finds children
     * @param {string} personId
     * @param {number} level
     * @return {Promise<{id:string, source: string|null, security: string[], children: *[]}>}
     */
    async findPersonAndChildrenAsync({personId, level}) {
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        const person = await databaseQueryManager.findOneAsync({
            query: {id: personId},
        });
        if (!person) {
            return {
                id: personId,
                resourceType: 'Person',
                source: '[Resource missing]'
            };
        }
        // find parents
        let parentPersons = [];

        const mapResource = (resourceObj) => {
            return {
                id: resourceObj.id,
                resourceType: resourceObj.resourceType,
                source: resourceObj.meta ? resourceObj.meta.source : null,
                owner: resourceObj.meta && resourceObj.meta.security ?
                    resourceObj.meta.security.filter(s => s.system === SecurityTagSystem.owner).map(s => s.code) : [],
                access: resourceObj.meta && resourceObj.meta.security ?
                    resourceObj.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code) : [],
            };
        };

        if (level === 1) {
            // find all links to this Person
            /**
             * @type {DatabasePartitionedCursor}
             */
            const personsLinkingToThisPersonId = await databaseQueryManager.findAsync(
                {
                    query: {
                        'link.target.reference': `Person/${personId}`
                    }
                }
            );

            parentPersons = (await personsLinkingToThisPersonId.toArrayRawAsync()).map(mapResource);
        }

        /**
         * @type {{id:string, source: string|null, security: string[]}[]}
         */
        let children = [];
        if (person && person.link && person.link.length > 0) {
            const patientIds = person.link
                .filter(l => l.target && l.target.reference &&
                    (l.target.reference.startsWith(patientReferencePrefix) || l.target.type === 'Patient'))
                .map(l => l.target.reference.replace(patientReferencePrefix, ''));

            const patientDatabaseManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Patient', base_version: base_version
            });
            /**
             * @type {DatabasePartitionedCursor}
             */
            const patientCursor = await patientDatabaseManager.findAsync({
                query: {id: {$in: patientIds}}
            });
            /**
             * @type {Patient[]}
             */
            const patients = await patientCursor.toArrayRawAsync();
            children = children.concat(
                patients.map(mapResource)
            );
            const missingPatientIds = patientIds.filter(i => !patients.map(p => p.id).includes(i));
            if (missingPatientIds.length > 0) {
                children = children.concat(
                    missingPatientIds.map(
                        m => {
                            return {
                                id: m,
                                resourceType: 'Patient',
                                source: '[Resource missing]'
                            };
                        }
                    )
                );
            }
            if (level < maximumRecursionDepth) { // avoid infinite loop
                // now find any Person links and call them recursively
                /**
                 * @type {string[]}
                 */
                const personIdsToRecurse = person.link
                    .filter(l => l.target && l.target.reference &&
                        (l.target.reference.startsWith(personReferencePrefix) || l.target.type === 'Person'))
                    .map(l => l.target.reference.replace(personReferencePrefix, ''));
                for (const /** @type {string} */ personIdToRecurse of personIdsToRecurse) {
                    children.push(
                        await this.findPersonAndChildrenAsync({personId: personIdToRecurse, level: level + 1})
                    );
                }
            }
        }
        const result = {
            id: person.id,
            resourceType: person.resourceType,
            source: person.meta ? person.meta.source : null,
            owner: person.meta && person.meta.security ?
                person.meta.security.filter(s => s.system === SecurityTagSystem.owner).map(s => s.code) : [],
            access: person.meta && person.meta.security ?
                person.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code) : [],
        };
        if (children.length > 0) {
            result.children = children;
        }
        if (parentPersons.length > 0) {
            result.parents = parentPersons;
        }
        return result;
    }

    /**
     * gets hierarchy
     * @param {string} bwellPersonId
     * @return {Promise<{id: string, source: (string|null), security: string[], children: *[]}>}
     */
    async showPersonToPersonLinkAsync({bwellPersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        return await this.findPersonAndChildrenAsync({personId: bwellPersonId, level: 1});
    }

    /**
     * deletes a Person and remove any links to it
     * @param {string} requestId
     * @param {string} personId
     * @return {Promise<{deletedCount: (number|null), error: (Error|null)}>}
     */
    async deletePersonAsync({req, requestId, personId}) {
        personId = personId.replace('Person/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        // find all links to this Person
        /**
         * @type {DatabasePartitionedCursor}
         */
        const personsLinkingToThisPersonId = await databaseQueryManager.findAsync(
            {
                query: {
                    'link.target.reference': `Person/${personId}`
                }
            }
        );
        const parentPersonResponses = [];
        // iterate and remove links to this person
        while (await personsLinkingToThisPersonId.hasNext()) {
            const parentPerson = await personsLinkingToThisPersonId.next();
            const removePersonResult = await this.removePersonToPersonLinkAsync({
                req,
                bwellPersonId: parentPerson.id,
                externalPersonId: personId
            });
            parentPersonResponses.push(removePersonResult);
        }
        /**
         * @type {{deletedCount: (number|null), error: (Error|null)}}
         */
        const result = await databaseQueryManager.deleteManyAsync({
            query: {id: personId},
            requestId
        });
        result['linksRemoved'] = parentPersonResponses;
        return result;
    }
}

module.exports = {
    AdminPersonPatientLinkManager
};
