const {assertTypeEquals} = require('./assertType');
const {PATIENT_REFERENCE_PREFIX, PERSON_REFERENCE_PREFIX, PERSON_PROXY_PREFIX, BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY} = require('../constants');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {SecurityTagSystem} = require('./securityTagSystem');
const { isUuid, generateUUIDv5 } = require('./uid.util');
const { SearchFilterFromReference } = require('../operations/query/filters/searchFilterFromReference');
const { ReferenceParser } = require('./referenceParser');
const { logWarn } = require('../operations/common/logging');

const BwellMasterPersonCode = BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY;
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
            currentSubject: `${PATIENT_REFERENCE_PREFIX}${patientId}`,
            databaseQueryManager: databaseQueryManager,
            visitedSubjects: new Set()
        });
    }

    /**
     * finds bwell person Ids associated with patientsIds
     * @param {{ patientReferences: import('../operations/query/filters/searchFilterFromReference').IReferences}} options List of patient and proxy-patient References
     * @returns {Promise<Map<string, string>>} Returns map with key as patientId and value as master-persons-id
     */
    async getBwellPersonIdsAsync({
        patientReferences
    }) {
        /**@type {import('../operations/query/filters/searchFilterFromReference').IReferences} */
        const onlyPatientRefs = [];
        /**@type {Set<string>} */
        const proxyPatientIds = new Set();

        patientReferences.forEach((ref) => {
            const {id} = ref;
            if (id.startsWith(`${PERSON_PROXY_PREFIX}`)) {
                proxyPatientIds.add(id);
            } else {
                onlyPatientRefs.push(ref);
            }
        });
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });

        const patientsToBwellPersonRefs = await this.searchForBwellPersonsAsync({
            references: onlyPatientRefs,
            databaseQueryManager,
            level: 0,
            visitedReferences: new Set(),
        });

        /**
         * check if proxy patient is bwell master person,
         * it must be available in patientsToBwellPerson Map
         */
        const masterPersonUuidRefs = new Set(patientsToBwellPersonRefs.values());
        proxyPatientIds.forEach((id) => {
            const idWithoutPrefix = id.replace(PERSON_PROXY_PREFIX, '');
            /**
             * masterPersons is an array of uuid-reference but proxy-patient can be a source-id/uuid
             * To check given proxy-patient is a master person, we can generate uuid from the proxy-patient-id
             * and check if its present in masterPerson array
             */
            const uuid = isUuid(idWithoutPrefix) ? idWithoutPrefix : generateUUIDv5(`${idWithoutPrefix}|${BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY}`);
            const uuidReference = `${PERSON_REFERENCE_PREFIX}${uuid}`;
            if (masterPersonUuidRefs.has(uuidReference)) {
                patientsToBwellPersonRefs.set(`${PATIENT_REFERENCE_PREFIX}${id}`, uuidReference);
                proxyPatientIds.delete(id);
            }
        });

        // Process remaining proxy patient, it can be non master person ID only
        const proxyReferenceArr = Array.from(proxyPatientIds).reduce((/**@type {Array<import('../operations/query/filters/searchFilterFromReference').IReferences>}*/refs, proxyPatent) => {
            const personId = proxyPatent.replace(`${PERSON_PROXY_PREFIX}`, '');
            const { id, resourceType } = ReferenceParser.parseReference(`${PERSON_REFERENCE_PREFIX}${personId}`);
            refs.push({ resourceType, id });
            return refs;
        }, []);
        const proxyPatientsToBwellPersonRefs = await this.searchForBwellPersonsAsync({
            references: proxyReferenceArr,
            databaseQueryManager,
            level: 0,
            visitedReferences: new Set(),
        });

        // Add remaining proxy patient to patient master person map
        for (const [personRefOfProxyPatient, masterPersonRef] of proxyPatientsToBwellPersonRefs.entries()) {
            const personID = personRefOfProxyPatient.replace(`${PERSON_REFERENCE_PREFIX}`, '');
            patientsToBwellPersonRefs.set(`${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${personID}`, masterPersonRef);
        }

        return patientsToBwellPersonRefs;
    }

    /**
     * Finds bwell master person for given references and returns a map of `reference -> uuid masterPersonReference`
     * @typedef {Object} Options
     * @property {import('../operations/query/filters/searchFilterFromReference').IReferences} references
     * @property {import('../dataLayer/databaseQueryManager').DatabaseQueryManager} databaseQueryManager
     * @property {number} level BFS Level (Starting with 0)
     * @property {Set<string>} visitedReferences Visited References
     * @param {Options}
     * @returns Returns a map of currentReference -> bwell-master-person uuid reference
     */
    async searchForBwellPersonsAsync({
        databaseQueryManager, level, visitedReferences, references
    }) {

        if (!references || Object.keys(references).length === 0) {
            let message = `No references were passed for depth: ${level}. Returning`;
            logWarn(message, { currentReferences: references, totalProcessedReferences: Array.from(visitedReferences)});
            /**@type {Map<string, string>} */
            const emptyMap = new Map();
            return emptyMap;
        }

        if (level === MaxDepthForBFS) {
            let message = `Maximum recursion depth of ${MaxDepthForBFS} reached while recursively fetching master-person`;
            logWarn(message, { currentReferences: references, totalProcessedReferences: Array.from(visitedReferences)});
            /**@type {Map<string, string>} */
            const emptyMap = new Map();
            return emptyMap;
        }

        /**
         * CurrentReferences passed in currentRefMap
         * @type {string[]}
         **/
        let currentReferences = [];
        const referencesToProcess = references
            // filter all not visited
            .filter((r) => {
                const currReferenceStr = ReferenceParser.createReference({...r});
                currentReferences.push(currReferenceStr);

                const isNotVisited = !visitedReferences.has(currReferenceStr);
                if (isNotVisited) {
                    // visit it
                    visitedReferences.add(currReferenceStr);
                }
                return isNotVisited;
            })
            // create idToRef Map
            .reduce((/**@type {import('../operations/query/filters/searchFilterFromReference').IReferences}*/refs, ref) => {
                // add all unvisited ref to the map
                refs.push(ref);
                return refs;
            }, []);

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


        // build query based on map
        const searchFilters = SearchFilterFromReference.buildFilter(referencesToProcess, 'link.target');

        // get all persons who have reference of currentReferencesToProcess
        let linkedPersonCursor = await databaseQueryManager.findAsync({
            query: {
                '$or': searchFilters
            }
        });

        while (await linkedPersonCursor.hasNext()) {
            let linkedPerson = await linkedPersonCursor.next();
            const personUuid = linkedPerson._uuid;
            const linkedReferences = this.getAllLinkedReferencesFromPerson(linkedPerson, currentReferences);
            nextRefToCurrRefsMap.set(`${PERSON_REFERENCE_PREFIX}${personUuid}`, linkedReferences);

            // a bwell person can be linked to multiple patients or persons.
            if (this.isBwellPerson(linkedPerson)) {
                const bwellPerson = `${PERSON_REFERENCE_PREFIX}${personUuid}`;
                bwellPersonToCurrRefsMap.set(bwellPerson, linkedReferences);
            } else {
                // next references to process
                nextRefToProcess.add(`${PERSON_REFERENCE_PREFIX}${personUuid}`);
            }
        }

        const nextRefArray = Array.from(nextRefToProcess).reduce((nextRefs, ref) => {
            const { id, resourceType } = ReferenceParser.parseReference(ref);
            // no need of sourceAssigning authority as all are uuids
            nextRefs.push({ id, resourceType });
            return nextRefs;
        }, []);
        // find bwell person from next level
        const nextRefToBwellPersonMap = await this.searchForBwellPersonsAsync({
            databaseQueryManager,
            level: level + 1,
            visitedReferences,
            references: nextRefArray,
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
     * @param {string[]} referencesToSearchFrom references to search from If can be uuid reference or sourceId reference
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
            if (reference && reference._uuid && referencesToSearchFrom.includes(reference._uuid)) {
                linkedIds.push(reference._uuid);
            } else if (reference && reference._sourceId) {
                const id = reference._sourceId;
                const sourceAssigningAuthority = reference._sourceAssigningAuthority;
                const refString = ReferenceParser.createReference({ id, sourceAssigningAuthority });
                if (sourceAssigningAuthority && referencesToSearchFrom.includes(refString)) {
                    // if id|source was present in referencesToSearchFrom
                    linkedIds.push(refString);
                } else if (referencesToSearchFrom.includes(id)) {
                    // if sourceId is present in referencesToSearchFrom
                    linkedIds.push(id);
                }
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
        const isReferenceUuid = isUuid(currentSubject.replace(PERSON_REFERENCE_PREFIX, '').replace(PATIENT_REFERENCE_PREFIX, ''));
        const resourceReferenceKey = 'link.target.reference'.replace('reference', isReferenceUuid ? '_uuid' : '_sourceId' );

        let linkedPersons = await databaseQueryManager.findAsync({ query: { [resourceReferenceKey]: currentSubject }});

        // iterate over linked Persons (breadth search)
        while (!foundPersonId && (await linkedPersons.hasNext())) {
            let nextPerson = await linkedPersons.next();
            const nextPersonId = nextPerson._uuid;
            if (this.isBwellPerson(nextPerson)) {
                foundPersonId = nextPersonId;
            }
            else {
                // recurse through to next layer of linked Persons (depth search)
                foundPersonId = await this.searchForBwellPersonAsync({
                    currentSubject: `Person/${nextPersonId}`,
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
