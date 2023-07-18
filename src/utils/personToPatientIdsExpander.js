const { FilterById } = require('../operations/query/filters/id');
const {assertTypeEquals} = require('./assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const { logWarn } = require('../operations/common/logging');

const patientReferencePrefix = 'Patient/';
const personReferencePrefix = 'Person/';
const personProxyPrefix = 'person.';
const patientReferencePlusPersonProxyPrefix = `${patientReferencePrefix}${personProxyPrefix}`;
const maximumRecursionDepth = 4;


class PersonToPatientIdsExpander {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor(
        {
            databaseQueryFactory
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * replaces patient proxy with actual patient ids
     * @param {string} base_version
     * @param {string} id
     * @param {boolean} includePatientPrefix
     * @return {Promise<string|string[]>}
     */
    async getPatientProxyIdsAsync({base_version, id, includePatientPrefix}) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });
        // 1. Get person id from id
        const personId = id.replace(patientReferencePlusPersonProxyPrefix, '').replace(personProxyPrefix, '');
        // 2. Get that Person resource from the database
        let patientIds = await this.getPatientIdsFromPersonAsync(
            {
                personIds: [ personId ],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager,
                level: 1
            }
        );
        if (patientIds && patientIds.length > 0) {
            // Also include the proxy patient ID for resources that are associated with the proxy patient directly
            patientIds.push(`${personProxyPrefix}${personId}`);
            if (includePatientPrefix) {
                patientIds = patientIds.map(p => `${patientReferencePrefix}${p}`);
            }
            // 4. return a csv of those patient ids (remove duplicates)
            return Array.from(new Set(patientIds));
        }
        return id;
    }

    /**
     * Get all related patients for the given master-persons.
     * It traverse down to find all patients.
     * @typedef {Object} RelatedPatientParam
     * @property {Set<string>} idsSet
     * @property {boolean} toMap If you want the result as map of id passed to patientIds, then pass it as true
     * @param {RelatedPatientParam} param
     * @returns {Promise<string[] | {[key: string]: string[]}}
     */
    async getAllRelatedPatients({base_version, idsSet, toMap = false}) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: base_version
        });

        /**@type {string[]} */
        const ids = [];
        idsSet.forEach((person) => {
            ids.push(person.replace('Person/', ''));
        });

        let patientIdsOrMap = await this.getPatientIdsFromPersonAsync(
            {
                personIds: [...ids],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager,
                level: 1,
                toMap,
            }
        );

        if (toMap === true) {
            /**@type {Map<string, Set<string>} */
            const patientIdsMap = patientIdsOrMap;
            const plainMap = {};
            for (const [personId, patientIds] of patientIdsMap) {
                // eslint-disable-next-line security/detect-object-injection
                plainMap[personId] = Array.from(patientIds);
            }

            return plainMap;
        }
        return patientIdsOrMap;
    }

    /**
     * gets patient ids (recursive) from a person
     * @param {string[]} personIds
     * @param {Set} totalProcessedPersonIds
     * @param {DatabaseQueryManager} databaseQueryManager
     * @param {number} level
     * @param {boolean} toMap If passed, will return a map of personId -> all related personIds
     * @return {Promise<string[] | Map<string, Set<string>>} Will return an array if toMap is false else return an map. By default toMap is false
     */
    async getPatientIdsFromPersonAsync({
        personIds, totalProcessedPersonIds, databaseQueryManager, level, toMap = false,
    }) {

        /**
         * Final result to return
         * Stores all linked patient to current person
         * @type {Map<string, Set<string>>}
         */
        let personToLinkedPatient = new Map();

        /**
         * Stores linked person to all base person
         * @type {Map<string, Set<string>>}
         */
        let linkedPersonToPersons = new Map();

        const personResourceCursor = await databaseQueryManager.findAsync(
            {
                query: FilterById.getListFilter(personIds),
                options: {projection: {id: 1, link: 1, _id: 0}}
            }
        );
        /**
         * @type {string[]}
         */
        let patientIds = [];
        let personIdsToRecurse = [];
        while (await personResourceCursor.hasNext()) {
            let person = await personResourceCursor.next();
            if (person && person.link && person.link.length > 0 && !totalProcessedPersonIds.has(person.id)) {
                const linkedPatients = personToLinkedPatient.get(person.id) || new Set();

                const patientIdsToAdd = person.link
                    .filter(l => l.target && l.target.reference &&
                        (l.target.reference.startsWith(patientReferencePrefix) || l.target.type === 'Patient'))
                    .map(l => {
                        const patientId = l.target.reference.replace(patientReferencePrefix, '');
                        if (toMap === true) {
                            // add linked patient id to the person
                            linkedPatients.add(patientId);
                        }
                        return patientId;
                    });

                // todo: add patients to map
                patientIds = patientIds.concat(patientIdsToAdd);

                const personResourceWithPersonReferenceLink = person.link
                    .filter(l => l.target && l.target.reference &&
                        (l.target.reference.startsWith(personReferencePrefix) || l.target.type === 'Person'))
                    .map(l => {
                        const linkedPersonId = l.target.reference.replace(personReferencePrefix, '');
                        if (toMap === true){
                            const personsOfLinkedPerson = linkedPersonToPersons.get(linkedPersonId) || new Set();
                            // add person to linked person
                            // it can be possible that 1 person can be linked to 2 curr persons
                            personsOfLinkedPerson.add(person.id);
                            linkedPersonToPersons.set(linkedPersonId, personsOfLinkedPerson);
                        }
                        return linkedPersonId;
                    });

                personIdsToRecurse = personIdsToRecurse.concat(personResourceWithPersonReferenceLink);

                // finally update the sets
                personToLinkedPatient.set(person.id, linkedPatients);
            }
        }

        if (level === maximumRecursionDepth) {
            let message = `Maximum recursion depth of ${maximumRecursionDepth} reached while recursively fetching patient ids from person links`;
            logWarn(message, {patientIds: patientIds, personIdsToRecurse: personIdsToRecurse, totalProcessedPersonIds: [...totalProcessedPersonIds]});
            if (toMap) {
                return personToLinkedPatient;
            }
            return patientIds;
        }
        if (level < maximumRecursionDepth && personIdsToRecurse.length !== 0) {
            // avoid infinite loop
            if (toMap === true) {
                /**
                * @type {Map<string, Set<string>>}
                */
                const linkedPeronToPatientIdsMap = await this.getPatientIdsFromPersonAsync({
                    personIds: personIdsToRecurse,
                    totalProcessedPersonIds: new Set([...totalProcessedPersonIds, ...personIds]),
                    databaseQueryManager,
                    level: level + 1,
                    toMap,
                });

                // add all patients to current person
                for (const [linkedPerson, linkedPatients] of linkedPeronToPatientIdsMap) {
                    const currPersons = linkedPersonToPersons.get(linkedPerson);
                    if (currPersons) {
                        currPersons.forEach((currPerson) => {
                            const patientsLinkedToCurrentPerson = personToLinkedPatient.get(currPerson) || new Set();
                            linkedPatients.forEach((p) => {
                                patientsLinkedToCurrentPerson.add(p);
                            });
                            personToLinkedPatient.set(currPerson, patientsLinkedToCurrentPerson);
                        });
                    }
                }

                // finally return the result
                return personToLinkedPatient;
            }

            /**
             * @type {string[]}
             */
            const patientIdsFromPersons = await this.getPatientIdsFromPersonAsync({
                personIds: personIdsToRecurse,
                totalProcessedPersonIds: new Set([...totalProcessedPersonIds, ...personIds]),
                databaseQueryManager,
                level: level + 1,
                toMap,
            });
            return patientIds.concat(patientIdsFromPersons);
        }

        return toMap === true ? personToLinkedPatient : patientIds;
    }
}

module.exports = {
    PersonToPatientIdsExpander
};
