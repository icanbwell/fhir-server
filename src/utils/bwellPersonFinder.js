const {assertTypeEquals} = require('./assertType');
const {PATIENT_REFERENCE_PREFIX, PERSON_REFERENCE_PREFIX, PERSON_PROXY_PREFIX, BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY} = require('../constants');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {SecurityTagSystem} = require('./securityTagSystem');
const { isUuid } = require('./uid.util');
const { SearchFilterFromReference } = require('../operations/query/filters/searchFilterFromReference');
const { ReferenceParser } = require('./referenceParser');
const { FilterById } = require('../operations/query/filters/id');

const BwellMasterPersonCode = BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY;

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
     * finds immediate person Ids associated with patientsIds
     * @param {{ patientReferences: import('../operations/query/filters/searchFilterFromReference').IReferences; asObject: boolean, securityTags?: string[] }} options List of patient and proxy-patient References
     * @returns {Promise<Map<string, string[]> | Map<string, import('../operations/query/filters/searchFilterFromReference').IReference[]>} Returns map with key as patientId and value as next level persons-id
     */
    async getImmediatePersonIdsOfPatientsAsync({ patientReferences, asObject, securityTags }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        const patientToImmediatePersonMap = await this.getImmediatePersonIdHelperAsync({ references: patientReferences, databaseQueryManager, asObject, securityTags });
        return patientToImmediatePersonMap;
    }

    /**
     * Finds immediate person for given references and returns a map of `reference -> person Uuid Ref`
     * @typedef {Object} GetImmediatePersonIdsHelperProps
     * @property {import('../operations/query/filters/searchFilterFromReference').IReferences} references
     * @property {import('../dataLayer/databaseQueryManager').DatabaseQueryManager} databaseQueryManager
     * @property {boolean} asObject If true, will return Map of PatientReference -> Person IReference
     * @property {string[] | undefined} securityTags
     * @param {GetImmediatePersonIdsHelperProps}
     * @returns {Promise<Map<string, string[]> | Map<string, import('../operations/query/filters/searchFilterFromReference').IReference[]>} Returns a map of patientRefs -> array of immediate person uuid refs
     */
    async getImmediatePersonIdHelperAsync({ references, databaseQueryManager, asObject, securityTags }) {
        if (!references || Object.keys(references).length === 0) {
            return new Map();
        }

        /**
         * @type {import('../operations/query/filters/searchFilterFromReference').IReferences}
         */
        const patientReferences = [];
        /**
         * @type {string[]}
         */
        const patientReferencesString = [];

        // build the filter
        const searchFilters = SearchFilterFromReference.buildFilter(references, 'link.target');

        // extract person id from proxy-patient id
        const personIds = new Set(references.filter((ref) => {
            if (ref.id.startsWith(PERSON_PROXY_PREFIX)) {
                return true;
            } else {
                patientReferences.push(ref);
                patientReferencesString.push(ReferenceParser.createReference({...ref}));
                return false;
            }
        }).map(ref => ref.id.replace(PERSON_PROXY_PREFIX, '')));

        const personIdFilter = FilterById.getListFilter(Array.from(personIds));

        /**
         * @type {Map<string, string[]> | Map<string, import('../operations/query/filters/searchFilterFromReference').IReference[]}
         */
        const patientRefToImmediatePersonRefMap = new Map();

        /**
         * @type {Map<string, string[]>}
         */
        const personRefToLinkedRefsMap = new Map();
        /**
         * @type {Map<string, import('../operations/query/filters/searchFilterFromReference').IReference}
         */
        const personRefToPersonRefObj = new Map();

        let query = {
            '$or': [
                ...searchFilters,
                personIdFilter
            ]
        };

        if (securityTags && securityTags.length > 0) {
            // client security tag should match the patient
            query = {
                $and: [
                    query,
                    {
                        'meta.security': {
                            '$elemMatch': {
                                'system': SecurityTagSystem.owner,
                                'code': {
                                    $in: securityTags
                                }
                            }
                        }
                    }
                ]
            };
        }

        // get all persons
        const linkedPersonCursor = await databaseQueryManager.findAsync({
            query
        });

        while (await linkedPersonCursor.hasNext()) {
            const linkedPerson = await linkedPersonCursor.next();
            const personUuidRef = `${PERSON_REFERENCE_PREFIX}${linkedPerson._uuid}`;
            const linkedReferences = this.getAllLinkedReferencesFromPerson(linkedPerson, patientReferencesString);
            personRefToLinkedRefsMap.set(personUuidRef, linkedReferences);

            if (asObject) {
                personRefToPersonRefObj.set(personUuidRef, {
                    id: linkedPerson._uuid,
                    resourceType: linkedPerson.resourceType,
                    sourceAssigningAuthority: linkedPerson._sourceAssigningAuthority
                });
            }

            /**
             * @type {string|undefined}
             */
            let proxyPatientRef;
            // add to map if person found for proxy-patient
            if (personIds.has(linkedPerson._uuid)) {
                proxyPatientRef = `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${linkedPerson._uuid}`;
            } else if (personIds.has(linkedPerson._sourceId)) {
                proxyPatientRef = `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${linkedPerson._sourceId}`;
            }

            if (proxyPatientRef && asObject) {
                patientRefToImmediatePersonRefMap.set(proxyPatientRef, [personRefToPersonRefObj.get(personUuidRef)]);
            } else if (proxyPatientRef){
                patientRefToImmediatePersonRefMap.set(proxyPatientRef, [personUuidRef]);
            }
        }

        // build map of patient to person
        for (const [person, linkedReferences] of personRefToLinkedRefsMap.entries()) {
            if (linkedReferences && linkedReferences.length > 0) {
                linkedReferences.forEach((currentReference) => {
                    const immediatePersons = patientRefToImmediatePersonRefMap.get(currentReference) ?? [];

                    if (asObject) {
                        immediatePersons.push(personRefToPersonRefObj.get(person));
                        patientRefToImmediatePersonRefMap.set(currentReference, immediatePersons);
                    } else {
                        immediatePersons.push(person);
                        patientRefToImmediatePersonRefMap.set(currentReference, immediatePersons);
                    }
                });
            }
        }

        return patientRefToImmediatePersonRefMap;
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

        const linkedPersons = await databaseQueryManager.findAsync({ query: { [resourceReferenceKey]: currentSubject }});

        // iterate over linked Persons (breadth search)
        while (!foundPersonId && (await linkedPersons.hasNext())) {
            const nextPerson = await linkedPersons.next();
            const nextPersonId = nextPerson._uuid;
            if (this.isBwellPerson(nextPerson)) {
                foundPersonId = nextPersonId;
            } else {
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
