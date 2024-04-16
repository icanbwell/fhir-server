const moment = require('moment-timezone');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../dataLayer/databaseUpdateFactory');
const { FhirOperationsManager } = require('../operations/fhirOperationsManager');
const { PostSaveProcessor } = require('../dataLayer/postSaveProcessor');
const { ReferenceParser } = require('../utils/referenceParser');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const Person = require('../fhir/classes/4_0_0/resources/person');
const PersonLink = require('../fhir/classes/4_0_0/backbone_elements/personLink');
const { logInfo } = require('../operations/common/logging');
const { assertTypeEquals } = require('../utils/assertType');
const { generateUUID, isUuid, generateUUIDv5 } = require('../utils/uid.util');
const { SecurityTagSystem } = require('../utils/securityTagSystem');
const { VERSIONS } = require('../middleware/fhir/utils/constants');

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
     * @param {PostSaveProcessor} postSaveProcessor
     * @param {ResourceMerger} resourceMerger
     */
    constructor (
        {
            databaseQueryFactory,
            databaseUpdateFactory,
            fhirOperationsManager,
            postSaveProcessor,
            resourceMerger
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

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);
    }

    /**
     * creates a person to person link
     * @param {import('http').IncomingMessage} req
     * @param {string} bwellPersonId
     * @param {string} externalPersonId
     * @return {Promise<Object>}
     */
    async createPersonToPersonLinkAsync ({ req, bwellPersonId, externalPersonId }) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        externalPersonId = externalPersonId.replace('Person/', '');
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Person',
            base_version
        });
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);

        /**
         * @type {Person}
         */
        const bwellPerson = await databaseQueryManager.findOneAsync({
            query: { id: bwellPersonId }
        });
        if (bwellPerson) {
            if (bwellPerson.link) {
                // check if a link target already exists in bwellPerson for externalPersonId
                if (!bwellPerson.link.some(l => l.target && l.target.reference === `Person/${externalPersonId}`)) {
                    logInfo('link before (non-empty)', { link: bwellPerson.link });
                    bwellPerson.link = bwellPerson.link.concat([
                        new PersonLink(
                            {
                                target: new Reference(
                                    { reference: `Person/${externalPersonId}` }
                                )
                            })
                    ]);
                    logInfo('link after (non-empty)', { link: bwellPerson.link });
                } else {
                    return {
                        message: `Link already exists from ${bwellPersonId} to ${externalPersonId}`,
                        bwellPersonId,
                        externalPersonId
                    };
                }
            } else {
                // no existing link array so create one
                logInfo('link before (empty)', { link: bwellPerson.link });
                bwellPerson.link = [new PersonLink(
                    {
                        target: new Reference(
                            { reference: `Person/${externalPersonId}` }
                        )
                    })];
                logInfo('link after (empty)', { link: bwellPerson.link });
            }
            // eslint-disable-next-line no-unused-vars
            const { savedResource, patches } = await databaseUpdateManager.replaceOneAsync({
                base_version,
                requestInfo,
                doc: bwellPerson
            });

            await databaseUpdateManager.postSaveAsync({
                base_version,
                requestInfo,
                doc: savedResource
            });

            await this.postSaveProcessor.afterSaveAsync({
                requestId: requestInfo.requestId,
                eventType: 'U',
                resourceType: 'Person',
                doc: bwellPerson
            });

            return {
                message: `Added link from Person/${bwellPersonId} to Person/${externalPersonId}`,
                bwellPersonId,
                externalPersonId
            };
        } else {
            return {
                message: `No Person found with id ${bwellPersonId}`,
                bwellPersonId,
                externalPersonId
            };
        }
    }

    /**
     * removes a person to person link
     * @param {import('http').IncomingMessage} req
     * @param {string} bwellPersonId
     * @param {string} externalPersonId
     * @return {Promise<Object>}
     */
    async removePersonToPersonLinkAsync ({ req, bwellPersonId, externalPersonId }) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        externalPersonId = externalPersonId.replace('Person/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);

        /**
         * @type {Person}
         */
        const bwellPerson = await databaseQueryManager.findOneAsync({
            query: { [isUuid(bwellPersonId) ? '_uuid' : '_sourceId']: bwellPersonId }
        });
        if (bwellPerson) {
            if (bwellPerson.link) {
                // check if a link target already exists in bwellPerson for externalPersonId
                if (!bwellPerson.link.some(l => l.target && (
                    l.target.reference === `Person/${externalPersonId}` ||
                    l.target._uuid === `Person/${externalPersonId}`
                ))) {
                    return {
                        message: `No Link exists from Person/${bwellPersonId} to Person/${externalPersonId}`,
                        bwellPersonId,
                        externalPersonId
                    };
                } else {
                    logInfo('link before', { link: bwellPerson.link });
                    bwellPerson.link = bwellPerson.link.filter(l => (
                        l.target.reference !== `Person/${externalPersonId}` &&
                        l.target._uuid !== `Person/${externalPersonId}`
                    ));
                    logInfo('link after', { link: bwellPerson.link });
                }
            } else {
                return {
                    message: `No Link exists from Person/${bwellPersonId} to Person/${externalPersonId}`,
                    bwellPersonId,
                    externalPersonId
                };
            }
            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Person',
                base_version
            });
            // eslint-disable-next-line no-unused-vars
            const { savedResource, patches } = await databaseUpdateManager.replaceOneAsync({
                base_version,
                requestInfo,
                doc: bwellPerson,
                smartMerge: false
            });

            await databaseUpdateManager.postSaveAsync({
                base_version,
                requestInfo,
                doc: savedResource
            });

            await this.postSaveProcessor.afterSaveAsync({
                requestId: requestInfo.requestId,
                eventType: 'U',
                resourceType: 'Person',
                doc: bwellPerson
            });

            return {
                message: `Removed link from Person/${bwellPersonId} to Person/${externalPersonId}`,
                bwellPersonId,
                externalPersonId
            };
        } else {
            return {
                message: `No Person found with id ${bwellPersonId}`,
                bwellPersonId,
                externalPersonId
            };
        }
    }

    /**
     * creates a person to patient link
     * @param {import('http').IncomingMessage} req
     * @param {string} externalPersonId
     * @param {string} patientId
     * @return {Promise<Object>}
     */
    async createPersonToPatientLinkAsync ({ req, externalPersonId, patientId }) {
        externalPersonId = externalPersonId.replace('Person/', '');
        patientId = patientId.replace('Patient/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Person',
            base_version
        });
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);

        /**
         * @type {Person}
         */
        let sourcePerson = await databaseQueryManager.findOneAsync({
            query: { [isUuid(externalPersonId) ? '_uuid' : 'id']: externalPersonId }
        });
        if (!sourcePerson) {
            // create it
            // first read the meta tags from the patient
            const patientDatabaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Patient',
                base_version
            });
            /**
             * @type {Patient|null}
             */
            const patient = await patientDatabaseQueryManager.findOneAsync({
                query: { [isUuid(patientId) ? '_uuid' : 'id']: patientId }
            });
            if (!patient) {
                return {
                    message: `No Patient found for id: ${patientId}`,
                    patientId,
                    externalPersonId
                };
            }
            /**
             * @type {Meta}
             */
            const meta = patient.meta;
            sourcePerson = new Person({
                id: generateUUID(),
                meta: {
                    id: generateUUID(),
                    versionId: 1,
                    lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
                    source: meta.source,
                    security: meta.security
                },
                link: [
                    new PersonLink(
                        {
                            target: new Reference({ reference: `Patient/${patientId}` }
                            )
                        })
                ]
            });
            const savedResource = await databaseUpdateManager.insertOneAsync({
                base_version,
                requestInfo,
                doc: sourcePerson
            });

            await databaseUpdateManager.postSaveAsync({
                base_version,
                requestInfo,
                doc: savedResource
            });

            await this.postSaveProcessor.afterSaveAsync({
                requestId: requestInfo.requestId,
                eventType: 'U',
                resourceType: 'Person',
                doc: sourcePerson
            });

            return {
                message: `Created Person and added link from Person/${externalPersonId} to Patient/${patientId}`,
                patientId,
                externalPersonId
            };
        } else {
            if (sourcePerson.link) {
                // check if a link target already exists in sourcePerson for externalPersonId
                if (!sourcePerson.link.some(l => l.target && l.target.reference === `Patient/${patientId}`)) {
                    logInfo('link before (non-empty)', { link: sourcePerson.link });
                    sourcePerson.link = sourcePerson.link.concat([
                        new PersonLink(
                            {
                                target: new Reference({ reference: `Patient/${patientId}` }
                                )
                            })
                    ]);
                    logInfo('link before (non-empty)', { link: sourcePerson.link });
                } else {
                    return {
                        message: `Link already exists from Person/${externalPersonId} to Patient/${patientId}`,
                        patientId,
                        externalPersonId
                    };
                }
            } else {
                logInfo('link before (empty)', { link: sourcePerson.link });
                sourcePerson.link = [
                    new PersonLink(
                        {
                            target: new Reference(
                                { reference: `Patient/${patientId}` }
                            )
                        })];
                logInfo('link after', { link: sourcePerson.link });
            }
            // eslint-disable-next-line no-unused-vars
            const { savedResource, patches } = await databaseUpdateManager.replaceOneAsync({
                base_version,
                requestInfo,
                doc: sourcePerson
            });

            await databaseUpdateManager.postSaveAsync({
                base_version,
                requestInfo,
                doc: savedResource
            });

            await this.postSaveProcessor.afterSaveAsync({
                requestId: requestInfo.requestId,
                eventType: 'U',
                resourceType: 'Person',
                doc: sourcePerson
            });

            return {
                message: `Added link from Person/${externalPersonId} to Patient/${patientId}`,
                patientId,
                externalPersonId
            };
        }
    }

    /**
     * removes a person to patient link
     * @param {import('http').IncomingMessage} req
     * @param {string} personId
     * @param {string} patientId
     * @return {Promise<Object>}
     */
    async removePersonToPatientLinkAsync ({ req, personId, patientId }) {
        personId = personId.replace('Person/', '');
        patientId = patientId.replace('Patient/', '');

        /**
         * @type {import('../dataLayer/databaseQueryManager').DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);

        /**
         * @type {Person}
         */
        const person = await databaseQueryManager.findOneAsync({
            query: { [isUuid(personId) ? '_uuid' : '_sourceId']: personId }
        });
        if (person) {
            if (person.link) {
                // check if a link target already exists in person for patientId
                if (!person.link.some(l => l.target && (
                        l.target.reference === `Patient/${patientId}` ||
                        l.target._uuid === `Patient/${patientId}`
                    ))
                ) {
                    return {
                        message: `No Link exists from Person/${personId} to Patient/${patientId}`,
                        personId,
                        patientId
                    };
                } else {
                    logInfo('link before', { link: person.link });
                    person.link = person.link.filter(l => (
                        l.target.reference !== `Patient/${patientId}` &&
                        l.target._uuid !== `Patient/${patientId}`
                    ));
                    logInfo('link after', { link: person.link });
                }
            } else {
                return {
                    message: `No Link exists from Person/${personId} to Patient/${patientId}`,
                    personId,
                    patientId
                };
            }
            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Person',
                base_version
            });

            const { savedResource } = await databaseUpdateManager.replaceOneAsync({
                base_version,
                requestInfo,
                doc: person,
                smartMerge: false
            });

            await databaseUpdateManager.postSaveAsync({
                base_version,
                requestInfo,
                doc: savedResource
            });

            await this.postSaveProcessor.afterSaveAsync({
                requestId: requestInfo.requestId,
                eventType: 'U',
                resourceType: 'Person',
                doc: person
            });

            return {
                message: `Removed link from Person/${personId} to Patient/${patientId}`,
                personId,
                patientId
            };
        } else {
            return {
                message: `No Person found with id ${personId}`,
                personId,
                patientId
            };
        }
    }

    /**
     * recursively finds children
     * @param {string} personId
     * @param {number} level
     * @return {Promise<{id:string, source: string|null, security: string[], children: *[]}>}
     */
    async findPersonAndChildrenAsync ({ personId, level }) {
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });
        /** @type {Person|null} */
        const person = await databaseQueryManager.findOneAsync({
            query: { id: personId }
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
                owner: resourceObj.meta && resourceObj.meta.security
                    ? resourceObj.meta.security.filter(s => s.system === SecurityTagSystem.owner).map(s => s.code) : [],
                access: resourceObj.meta && resourceObj.meta.security
                    ? resourceObj.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code) : []
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
                resourceType: 'Patient', base_version
            });
            /**
             * @type {DatabasePartitionedCursor}
             */
            const patientCursor = await patientDatabaseManager.findAsync({
                query: { id: { $in: patientIds } }
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
                        await this.findPersonAndChildrenAsync({ personId: personIdToRecurse, level: level + 1 })
                    );
                }
            }
        }
        const result = {
            id: person.id,
            resourceType: person.resourceType,
            source: person.meta ? person.meta.source : null,
            owner: person.meta && person.meta.security
                ? person.meta.security.filter(s => s.system === SecurityTagSystem.owner).map(s => s.code) : [],
            access: person.meta && person.meta.security
                ? person.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code) : []
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
    async showPersonToPersonLinkAsync ({ bwellPersonId }) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        return await this.findPersonAndChildrenAsync({ personId: bwellPersonId, level: 1 });
    }

    /**
     * deletes a Person and remove any links to it
     * @param {import('http').IncomingMessage} req
     * @param {string} requestId
     * @param {string} personId
     * @return {Promise<{deletedCount: (number|null), error: (Error|null)}>}
     */
    async deletePersonAsync ({ req, requestId, personId }) {
        personId = personId.replace('Person/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
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

        const personToDelete = await databaseQueryManager.findOneAsync({
            query: { [isUuid(personId) ? '_uuid' : 'id']: personId }
        })
        /**
         * @type {{deletedCount: (number|null), error: (Error|null)}}
         */
        const result = await databaseQueryManager.deleteManyAsync({
            query: { id: personId },
            requestId
        });
        result.linksRemoved = parentPersonResponses;

        await this.postSaveProcessor.afterSaveAsync({
            requestId,
            eventType: 'U',
            resourceType: 'Person',
            doc: personToDelete
        });

        return result;
    }

    /**
     * Updates patient in the provided resource
     * @typedef {Object} UpdatePatientLinkAsyncParams
     * @property {import('http').IncomingMessage} req
     * @property {string} resourceId
     * @property {string} resourceType
     * @property {string} patientId
     *
     * @param {UpdatePatientLinkAsyncParams}
     */
    async updatePatientLinkAsync ({ req, resourceId, resourceType, patientId }) {
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);

        // if id and sourceAssigningAuthority is passed convert to uuid
        const { id, sourceAssigningAuthority } = ReferenceParser.parseReference(resourceId);
        if (id && sourceAssigningAuthority) {
            resourceId = generateUUIDv5(resourceId);
        }
        /**
         * @type {import('../dataLayer/databaseQueryManager').DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType,
            base_version
        });
        /**
         * @type {import('../../fhir/classes/4_0_0/resources/resource')}
         */
        const relatedResource = await databaseQueryManager.findOneAsync({
            query: {
                [isUuid(resourceId) ? '_uuid' : '_sourceId']: resourceId
            }
        });

        if (!relatedResource) {
            return {
                message: `${resourceType} with id ${resourceId} does not exist`
            };
        }

        const isReferenceUpdated = this.resourceMerger.updatePatientReference({
            reference: ReferenceParser.createReference({ resourceType: 'Patient', id: patientId }),
            resourceToMerge: relatedResource
        });

        if (isReferenceUpdated) {
            // increment versionId
            relatedResource.meta.versionId = `${parseInt(relatedResource.meta.versionId) + 1}`;

            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType,
                base_version
            });

            await databaseUpdateManager.updateOneAsync({
                requestInfo,
                doc: relatedResource
            });

            await this.postSaveProcessor.afterSaveAsync({
                requestId: requestInfo.requestId,
                eventType: 'U',
                resourceType,
                doc: relatedResource
            });

            return {
                message: `Patient reference updated for ${resourceType} with id ${resourceId}`,
                patientId
            };
        }

        return {
            message: `Couldn't update Patient reference in ${resourceType} with id ${resourceId}`,
            patientId
        };
    }
}

module.exports = {
    AdminPersonPatientLinkManager
};
