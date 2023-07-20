const {assertTypeEquals} = require('./assertType');
const {PATIENT_REFERENCE_PREFIX, PERSON_REFERENCE_PREFIX, PERSON_PROXY_PREFIX} = require('../constants');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {SecurityTagSystem} = require('./securityTagSystem');

const BwellMasterPersonCode = 'bwell';
const MaxDepthForBFS = 3;

class BwellPersonFinder {
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
     * finds the bwell person ID associated with a provided patient ID
     * @param {string} patientId
     * @return {Promise<string>}
     */
    async getBwellPersonIdAsync({ patientId}) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });

        return await this.searchForBwellPersonAsync({
            currentSubject: `Patient/${patientId}`,
            databaseQueryManager: databaseQueryManager,
            visitedSubjects: new Set()
        });
    }

    /**
     * finds bwell person Ids associated with patientsIds
     * @param {string[]} patientIds List of patient Ids
     * @returns {Promise<Map<string, string>>} Returns map with key as patientId and value as master-persons-id
     */
    async getBwellPersonIdsAsync({
        patientIds
    }) {
        /**@type {string[]} */
        const patientReferences = [];
        /**@type {string[]} */
        const proxyPatientIds = new Set();

        patientIds.forEach((id) => {
            if (id.startsWith(`${PERSON_PROXY_PREFIX}`)) {
                proxyPatientIds.add(id);
            } else {
                patientReferences.push(`${PATIENT_REFERENCE_PREFIX}${id}`);
            }
        });
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });

        const patientsToBwellPerson = await this.searchForBwellPersonsAsync({
            currentReferences: patientReferences,
            databaseQueryManager,
            level: 0,
            visitedReferences: new Set(),
        });

        /**
         * check if proxy patient is bwell master person,
         * it must be available in patientsToBwellPerson Map
         */
        for (const /**@type {string} */ masterPerson of patientsToBwellPerson.values()) {
            const personID = masterPerson.replace(`${PERSON_REFERENCE_PREFIX}`, '');
            const proxyPatient = `${PERSON_PROXY_PREFIX}${personID}`;
            if (proxyPatientIds.has(proxyPatient)) {
                patientsToBwellPerson.set(proxyPatient, masterPerson);
                proxyPatientIds.delete(proxyPatient);
            }
        }
        // Process remaining proxy patient, it can be non master person ID only
        const proxyPatientsToBwellPerson = await this.searchForBwellPersonsAsync({
            currentReferences: [...proxyPatientIds].map((proxyPatent) => `${PERSON_REFERENCE_PREFIX}${proxyPatent.replace(`${PERSON_PROXY_PREFIX}`, '')}`),
            databaseQueryManager,
            level: 0,
            visitedReferences: new Set(),
        });
        // Add remaining proxy patient to patient master person map
        for (const [proxyPatient, masterPerson] of proxyPatientsToBwellPerson.entries()) {
            const personID = proxyPatient.replace(`${PERSON_REFERENCE_PREFIX}`, '');
            patientsToBwellPerson.set(`${PERSON_PROXY_PREFIX}${personID}`, masterPerson);
        }

        return patientsToBwellPerson;
    }

    /**
     * Finds bwell master person for given references and returns a map of `reference -> masterPersonReference`
     * @typedef {Object} Options
     * @property {string[]} currentReferences Current Resource References
     * @property {import('../dataLayer/databaseQueryManager').DatabaseQueryManager} databaseQueryManager
     * @property {number} level BFS Level
     * @property {Set<string>} visitedReferences Visited References
     * @param {Options}
     * @returns Map of Reference to BwellMasterPerson
     */
    async searchForBwellPersonsAsync({ currentReferences, databaseQueryManager, level, visitedReferences }) {
        if (level === MaxDepthForBFS || currentReferences.length === 0) {
            /**@type {Map<string, string>} */
            const emptyMap = new Map();
            return emptyMap;
        }

        const currRefsToProcess = currentReferences.filter((r) => {
            const isNotVisited = !visitedReferences.has(r);
            if (isNotVisited) {
                visitedReferences.add(r);
            }
            return isNotVisited;
        });

        /**
         * @type {Map<string, string[]>}
         * Multiple patients/person can have same bwell-master-person
         */
        let bwellPersonToCurrRefsMap = new Map();

        /**
         * @type {Map<string, string[]>}
         * @description A Person can have multiple references, so its possible that
         * for a linked person, we can have multiple references which are present in referenceToProcess
         */
        let nextRefToCurrRefsMap = new Map();

        /**@type {Set<string>} */
        let nextRefToProcess = new Set();


        // get all persons who have link.target.reference in currentReferencesToProcess
        let linkedPersonCursor = await databaseQueryManager.findAsync({
            query: { 'link.target.reference': {
                '$in': [...currRefsToProcess],
            },
        }});

        while (await linkedPersonCursor.hasNext()) {
            let linkedPerson = await linkedPersonCursor.next();
            const linkedReferences = this.getAllLinkedReferencesFromPerson(linkedPerson, currentReferences);
            nextRefToCurrRefsMap.set(`Person/${linkedPerson.id}`, linkedReferences);

            // a bwell person can be linked to multiple patients or persons.
            if (this.isBwellPerson(linkedPerson)) {
                const bwellPerson = `Person/${linkedPerson.id}`;
                bwellPersonToCurrRefsMap.set(bwellPerson, linkedReferences);
            } else {
                // next references to process
                nextRefToProcess.add(`Person/${linkedPerson.id}`);
            }
        }

        // find bwell person from next level
        const nextRefToBwellPersonMap = await this.searchForBwellPersonsAsync({
            currentReferences: Array.from(nextRefToProcess),
            databaseQueryManager,
            level: level + 1,
            visitedReferences
        });

        /**@type {Map<string, string>} */
        const currRefToBwellPersonMap = new Map();

        /**
         * for all references where bwell person is found from next level,
         * get currentReferences linked to nextLevelReference
         * and then add currentReference and bwell person to map
         */
        for (const [nextLevelReference, bwellPerson] of nextRefToBwellPersonMap.entries()) {
            const currRefsFromMap = nextRefToCurrRefsMap.get(nextLevelReference);
            if (currRefsFromMap && currRefsFromMap.length > 0) {
                currRefsFromMap.forEach((currentReference) => {
                    // set the bwell person of currentReference
                    currRefToBwellPersonMap.set(currentReference, bwellPerson);
                });
            }
        }

        // for all references where bwell person has been found, push the to map.
        // a reference can have only one master person
        for (const [bwellPerson, referencesOfCurrentLevel] of bwellPersonToCurrRefsMap.entries()) {
            if (referencesOfCurrentLevel && referencesOfCurrentLevel.length > 0) {
                referencesOfCurrentLevel.forEach((currentReference) => {
                    currRefToBwellPersonMap.set(currentReference, bwellPerson);
                });
            }
        }

        return currRefToBwellPersonMap;
    }

    /**
     * Gets intersection of all references linked to the person
     * @param {Person} person
     * @param {string[]} referencesToSearchFrom references to search from
     * @return {string[]} references linked to given person
     */
    getAllLinkedReferencesFromPerson(person, referencesToSearchFrom) {
        /**@type {string[]} */
        const linkedIds = [];

        /**
         * If person is not present or ids length is 0 or person link is not array
         * then return empty
         */
        if (!person || referencesToSearchFrom.length === 0 || !person.link || !Array.isArray(person.link)) {
            return [];
        }

        /**
         * @type {PersonLink[]}
         * @description Array of links
        */
        const links = person.link;
        links.forEach((link) => {
            // check if reference is included in referencesToSearchFrom, then add it to array
            const reference = link.target;
            if (reference && reference.reference && referencesToSearchFrom.includes(reference.reference)) {
                linkedIds.push(reference.reference);
            }
        });

        return linkedIds;
    }

    /**
     * recursively search through links to find a bwell Person
     * @param {string} currentSubject
     * @param {DatabaseQueryManager} databaseQueryManager for performing queries
     * @param {Set} visitedSubjects subjects that have already been visited (to avoid infinite loops)
     * @return {Promise<string>}
     */
    async searchForBwellPersonAsync({currentSubject, databaseQueryManager, visitedSubjects}) {
        if (visitedSubjects.has(currentSubject)) {
            return null;
        }

        visitedSubjects.add(currentSubject);

        let foundPersonId = null;
        let linkedPersons = await databaseQueryManager.findAsync({ query: { 'link.target.reference': currentSubject }});

        // iterate over linked Persons (breadth search)
        while (!foundPersonId && (await linkedPersons.hasNext())) {
            let nextPerson = await linkedPersons.next();

            if (this.isBwellPerson(nextPerson)) {
                foundPersonId = nextPerson.id;
            }
            else {
                // recurse through to next layer of linked Persons (depth search)
                foundPersonId = await this.searchForBwellPersonAsync({
                    currentSubject: `Person/${nextPerson.id}`,
                    databaseQueryManager: databaseQueryManager,
                    visitedSubjects: visitedSubjects
                });
            }
        }

        return foundPersonId;
    }

    /**
     * Check if the given Person document is a bwell master person or not
     * @param {Resource} person
     * @returns {boolean}
     */
    isBwellPerson(person){
        return person.meta.security &&
            person.meta.security.find(s => s.system === SecurityTagSystem.access && s.code === BwellMasterPersonCode) &&
            person.meta.security.find(s => s.system === SecurityTagSystem.owner && s.code === BwellMasterPersonCode);
    }
}

module.exports = {
    BwellPersonFinder
};
