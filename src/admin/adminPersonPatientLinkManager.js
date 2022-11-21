const {assertTypeEquals} = require('../utils/assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const {DatabaseUpdateFactory} = require('../dataLayer/databaseUpdateFactory');
const Person = require('../fhir/classes/4_0_0/resources/person');
const {generateUUID} = require('../utils/uid.util');
const moment = require('moment-timezone');
const {SecurityTagSystem} = require('../utils/securityTagSystem');
const PersonLink = require('../fhir/classes/4_0_0/backbone_elements/personLink');

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
     * @param {string} externalPersonId
     * @return {Promise<Object>}
     */
    async createPersonToPersonLinkAsync({bwellPersonId, externalPersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        externalPersonId = externalPersonId.replace('Person/', '');
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
                // check if a link target already exists in bwellPerson for externalPersonId
                if (!bwellPerson.link.some(l => l.target && l.target.reference === `Person/${externalPersonId}`)) {
                    console.log(`link before (non-empty): ${JSON.stringify(bwellPerson.link)}`);
                    bwellPerson.link = bwellPerson.link.concat([
                        new PersonLink(
                            {
                                target: new Reference(
                                    {reference: `Person/${externalPersonId}`}
                                )
                            })
                    ]);
                    console.log(`link after (non-empty): ${JSON.stringify(bwellPerson.link)}`);
                } else {
                    return {
                        'message': `Link already exists from ${bwellPersonId} to ${externalPersonId}`,
                        'bwellPersonId': bwellPersonId,
                        'externalPersonId': externalPersonId
                    };
                }
            } else {
                // no existing link array so create one
                console.log(`link before (empty): ${JSON.stringify(bwellPerson.link)}`);
                bwellPerson.link = [new PersonLink(
                    {
                        target: new Reference(
                            {reference: `Person/${externalPersonId}`}
                        )
                    })];
                console.log(`link after (empty): ${JSON.stringify(bwellPerson.link)}`);
            }
            await databaseUpdateManager.replaceOneAsync({
                doc: bwellPerson
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
     * @param {string} bwellPersonId
     * @param {string} externalPersonId
     * @return {Promise<Object>}
     */
    async removePersonToPersonLinkAsync({bwellPersonId, externalPersonId}) {
        bwellPersonId = bwellPersonId.replace('Person/', '');
        externalPersonId = externalPersonId.replace('Person/', '');

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
                // check if a link target already exists in bwellPerson for externalPersonId
                if (!bwellPerson.link.some(l => l.target && l.target.reference === `Person/${externalPersonId}`)) {
                    return {
                        'message': `No Link exists from Person/${bwellPersonId} to Person/${externalPersonId}`,
                        'bwellPersonId': bwellPersonId,
                        'externalPersonId': externalPersonId
                    };
                } else {
                    console.log(`link before: ${JSON.stringify(bwellPerson.link)}`);
                    bwellPerson.link = bwellPerson.link.filter(l => (l.target.reference !== `Person/${externalPersonId}`));
                    console.log(`link after: ${JSON.stringify(bwellPerson.link)}`);
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
                base_version: '4_0_0'
            });
            await databaseUpdateManager.replaceOneAsync({
                doc: bwellPerson
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
     * @param {string} externalPersonId
     * @param {string} patientId
     * @return {Promise<Object>}
     */
    async createPersonToPatientLinkAsync({externalPersonId, patientId}) {
        externalPersonId = externalPersonId.replace('Person/', '');
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
            query: {id: externalPersonId}
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
            await databaseUpdateManager.insertOneAsync({doc: sourcePerson});
            return {
                'message': `Created Person and added link from Person/${externalPersonId} to Patient/${patientId}`,
                'patientId': patientId,
                'externalPersonId': externalPersonId
            };
        } else {
            if (sourcePerson.link) {
                // check if a link target already exists in sourcePerson for externalPersonId
                if (!sourcePerson.link.some(l => l.target && l.target.reference === `Patient/${patientId}`)) {
                    console.log(`link before (non-empty): ${JSON.stringify(sourcePerson.link)}`);
                    sourcePerson.link = sourcePerson.link.concat([
                        new PersonLink(
                            {
                                target: new Reference({reference: `Patient/${patientId}`}
                                )
                            })
                    ]);
                    console.log(`link before (non-empty): ${JSON.stringify(sourcePerson.link)}`);
                } else {
                    return {
                        'message': `Link already exists from Person/${externalPersonId} to Patient/${patientId}`,
                        'patientId': patientId,
                        'externalPersonId': externalPersonId
                    };
                }
            } else {
                console.log(`link before (empty): ${JSON.stringify(sourcePerson.link)}`);
                sourcePerson.link = [
                    new PersonLink(
                        {
                            target: new Reference(
                                {reference: `Patient/${patientId}`}
                            )
                        })];
                console.log(`link after: ${JSON.stringify(sourcePerson.link)}`);
            }
            await databaseUpdateManager.replaceOneAsync({
                doc: sourcePerson
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
            base_version: '4_0_0'
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

        const parentPersons = (await personsLinkingToThisPersonId.toArray()).map(p => {
            return {
                id: p.id,
                resourceType: p.resourceType,
                source: p.meta ? p.meta.source : null,
                owner: p.meta && p.meta.security ?
                    p.meta.security.filter(s => s.system === SecurityTagSystem.owner).map(s => s.code) : [],
                access: p.meta && p.meta.security ?
                    p.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code) : [],
            };
        });


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
                query: {id: {$in: patientIds}}
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

        const result = await this.findPersonAndChildrenAsync(
            {
                personId: bwellPersonId, level: 1
            }
        );
        return result;
    }

    /**
     * deletes a Person and remove any links to it
     * @param {string} personId
     * @return {Promise<{deletedCount: (number|null), error: (Error|null)}>}
     */
    async deletePersonAsync({personId}) {
        personId = personId.replace('Person/', '');

        /**
         * @type {DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
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
        });
        result['linksRemoved'] = parentPersonResponses;
        return result;
    }
}

module.exports = {
    AdminPersonPatientLinkManager
};
