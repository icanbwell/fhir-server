const {assertTypeEquals} = require('../utils/assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const {DatabaseUpdateFactory} = require('../dataLayer/databaseUpdateFactory');
const Person = require('../fhir/classes/4_0_0/resources/person');
const {generateUUID} = require('../utils/uid.util');
const moment = require('moment-timezone');
const {SecurityTagSystem} = require('../utils/securityTagSystem');

const maximumRecursionDepth = 5;
const patientReferencePrefix = 'Patient/';
const personReferencePrefix = 'Person/';

class AdminPersonPatientLinkManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     */
    constructor(
        {
            databaseQueryFactory,
            databaseUpdateFactory
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
    }

    /**
     * creates a person to person link
     * @param {string} bwellPersonId
     * @param {string} sourcePersonId
     * @return {Promise<Object>}
     */
    async createPersonToPersonLinkAsync({bwellPersonId, sourcePersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        sourcePersonId = sourcePersonId.replace('Person/', '');
        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Person',
            base_version: '4_0_0'
        });

        /**
         * @type {Person}
         */
        const bwellPerson = await databaseQueryManager.findOneAsync({
            query: {id: bwellPersonId}
        });
        if (bwellPerson) {
            if (bwellPerson.link) {
                // check if a link target already exists in bwellPerson for sourcePersonId
                if (!bwellPerson.link.some(l => l.target && l.target.reference === `Person/${sourcePersonId}`)) {
                    bwellPerson.link = bwellPerson.link.concat([
                        new Reference(
                            {reference: `Person/${sourcePersonId}`}
                        )
                    ]);
                } else {
                    return {
                        'message': `Link already exists from ${bwellPersonId} to ${sourcePersonId}`,
                        'bwellPersonId': bwellPersonId,
                        'sourcePersonId': sourcePersonId
                    };
                }
            } else {
                // no existing link array so create one
                bwellPerson.link = [new Reference(
                    {reference: `Person/${sourcePersonId}`}
                )];
            }
            await databaseUpdateManager.replaceOneAsync({
                doc: bwellPerson
            });

            return {
                'message': `Added link from ${bwellPersonId} to ${sourcePersonId}`,
                'bwellPersonId': bwellPersonId,
                'sourcePersonId': sourcePersonId
            };
        } else {
            return {
                'message': `No Person found with id ${bwellPersonId}`,
                'bwellPersonId': bwellPersonId,
                'sourcePersonId': sourcePersonId
            };
        }
    }

    /**
     * removes a person to person link
     * @param {string} bwellPersonId
     * @param {string} sourcePersonId
     * @return {Promise<Object>}
     */
    async removePersonToPersonLinkAsync({bwellPersonId, sourcePersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        sourcePersonId = sourcePersonId.replace('Person/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        /**
         * @type {Person}
         */
        const bwellPerson = await databaseQueryManager.findOneAsync({
            query: {id: bwellPersonId}
        });
        if (bwellPerson) {
            if (bwellPerson.link) {
                // check if a link target already exists in bwellPerson for sourcePersonId
                if (!bwellPerson.link.some(l => l.target && l.target.reference === `Person/${sourcePersonId}`)) {
                    return {
                        'message': `No Link exists from ${bwellPersonId} to ${sourcePersonId}`,
                        'bwellPersonId': bwellPersonId,
                        'sourcePersonId': sourcePersonId
                    };
                } else {
                    bwellPerson.link = bwellPerson.link.filter(l => !(l.target && l.target.reference === `Person/${sourcePersonId}`));
                }
            } else {
                return {
                    'message': `No Link exists from ${bwellPersonId} to ${sourcePersonId}`,
                    'bwellPersonId': bwellPersonId,
                    'sourcePersonId': sourcePersonId
                };
            }
            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Person',
                base_version: '4_0_0'
            });
            await databaseUpdateManager.replaceOneAsync({
                doc: bwellPerson
            });

            return {
                'message': `Removed link from ${bwellPersonId} to ${sourcePersonId}`,
                'bwellPersonId': bwellPersonId,
                'sourcePersonId': sourcePersonId
            };
        } else {
            return {
                'message': `No Person found with id ${bwellPersonId}`,
                'bwellPersonId': bwellPersonId,
                'sourcePersonId': sourcePersonId
            };
        }
    }

    /**
     * creates a person to patient link
     * @param {string} sourcePersonId
     * @param {string} patientId
     * @return {Promise<Object>}
     */
    async createPersonToPatientLinkAsync({sourcePersonId, patientId}) {
        sourcePersonId = sourcePersonId.replace('Person/', '');
        patientId = patientId.replace('Patient/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Person',
            base_version: '4_0_0'
        });

        /**
         * @type {Person}
         */
        let sourcePerson = await databaseQueryManager.findOneAsync({
            query: {id: sourcePersonId}
        });
        if (!sourcePerson) {
            // create it
            // first read the meta tags from the patient
            const patientDatabaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
            /**
             * @type {Patient|null}
             */
            const patient = await patientDatabaseQueryManager.findOneAsync({
                query: {id: patientId}
            });
            if (!patient) {
                return {
                    'message': `No Patient found for id: ${patientId}`,
                    'patientId': patientId,
                    'sourcePersonId': sourcePersonId
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
                    new Reference(
                        {reference: `Patient/${patientId}`}
                    )
                ]
            });
            await databaseUpdateManager.insertOneAsync({doc: sourcePerson});
            return {
                'message': `Created Person and added link from ${sourcePersonId} to ${patientId}`,
                'patientId': patientId,
                'sourcePersonId': sourcePersonId
            };
        } else {
            if (sourcePerson.link) {
                // check if a link target already exists in sourcePerson for sourcePersonId
                if (!sourcePerson.link.some(l => l.target && l.target.reference === `Patient/${patientId}`)) {
                    sourcePerson.link = sourcePerson.link.concat([
                        new Reference(
                            {reference: `Patient/${patientId}`}
                        )
                    ]);
                } else {
                    return {
                        'message': `Link already exists from ${sourcePersonId} to ${patientId}`,
                        'patientId': patientId,
                        'sourcePersonId': sourcePersonId
                    };
                }
            } else {
                sourcePerson.link = [new Reference(
                    {reference: `Patient/${patientId}`}
                )];
            }
            await databaseUpdateManager.replaceOneAsync({
                doc: sourcePerson
            });

            return {
                'message': `Added link from ${sourcePersonId} to ${patientId}`,
                'patientId': patientId,
                'sourcePersonId': sourcePersonId
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
            base_version: '4_0_0'
        });
        const person = await databaseQueryManager.findOneAsync({
            query: {id: personId},
        });
        if (!person) {
            return {
                id: personId
            };
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
                resourceType: 'Patient', base_version: '4_0_0'
            });
            /**
             * @type {DatabasePartitionedCursor}
             */
            const patientCursor = await patientDatabaseManager.findAsync({
                query: {id: {$in: [patientIds]}}
            });
            /**
             * @type {Patient[]}
             */
            const patients = await patientCursor.toArray();
            children = children.concat(
                patients.map((p) => {
                    return {
                        id: p.id,
                        resourceType: p.resourceType,
                        source: p.meta ? p.meta.source : null,
                        owner: p.meta && p.meta.security ?
                            p.meta.security.filter(s => s.system === SecurityTagSystem.owner).map(s => s.code) : [],
                        access: p.meta && p.meta.security ?
                            p.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code) : [],
                    };
                })
            );
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
        return result;
    }

    /**
     * gets hierarchy
     * @param {string} bwellPersonId
     * @return {Promise<{id: string, source: (string|null), security: string[], children: *[]}>}
     */
    async showPersonToPersonLinkAsync({bwellPersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');

        const result = await this.findPersonAndChildrenAsync(
            {
                personId: bwellPersonId, level: 1
            }
        );
        return result;
    }
}

module.exports = {
    AdminPersonPatientLinkManager
};
