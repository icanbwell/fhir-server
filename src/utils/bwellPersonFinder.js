const { assertTypeEquals } = require('./assertType');
const { PATIENT_REFERENCE_PREFIX, PERSON_REFERENCE_PREFIX, PERSON_PROXY_PREFIX, BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY } = require('../constants');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { SecurityTagSystem } = require('./securityTagSystem');
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
    constructor (
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
    async getBwellPersonIdAsync ({ patientId }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });

        return await this.searchForBwellPersonAsync({
            currentSubject: `${PATIENT_REFERENCE_PREFIX}${patientId}`,
            databaseQueryManager,
            visitedSubjects: new Set()
        });
    }

    /**
     * finds immediate person Ids associated with patientsIds
     * @param {{ patientReferences: import('../operations/query/filters/searchFilterFromReference').IReferences; asObject: boolean, securityTags?: string[] }} options List of patient and proxy-patient References
     * @returns {Promise<Map<string, string[]> | Map<string, import('../operations/query/filters/searchFilterFromReference').IReference[]>, Map<string, string[]>>} Returns map with key as patientId and value as next level persons-id & person to linked patients map
     */
    async getImmediatePersonIdsOfPatientsAsync ({ patientReferences, asObject, securityTags }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version: '4_0_0'
        });
        const { patientReferenceToPersonUuid, personToLinkedPatientsMap } = await this.getImmediatePersonIdHelperAsync({
            references: patientReferences, databaseQueryManager, asObject, securityTags
        });
        return { patientReferenceToPersonUuid, personToLinkedPatientsMap };
    }

    /**
     * Finds immediate person for given references and returns a map of `reference -> person Uuid Ref`
     * @typedef {Object} GetImmediatePersonIdsHelperProps
     * @property {import('../operations/query/filters/searchFilterFromReference').IReferences} references
     * @property {import('../dataLayer/databaseQueryManager').DatabaseQueryManager} databaseQueryManager
     * @property {boolean} asObject If true, will return Map of PatientReference -> Person IReference
     * @property {string[] | undefined} securityTags
     * @param {GetImmediatePersonIdsHelperProps}
     * @returns {Promise<Map<string, string[]> | Map<string, import('../operations/query/filters/searchFilterFromReference').IReference[]>, Map<string, string[]>>} Returns a map of patientRefs -> array of immediate person uuid refs & person to linked patients map
     */
    async getImmediatePersonIdHelperAsync ({ references, databaseQueryManager, asObject, securityTags }) {
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
                patientReferencesString.push(ReferenceParser.createReference({ ...ref }));
                return false;
            }
        }).map(ref => ref.id.replace(PERSON_PROXY_PREFIX, '')));

        const personIdFilter = FilterById.getListFilter(Array.from(personIds));

        /** @type {{[key: string]: string[]}} */
        const patientReferenceToPersonUuid = {};

        /**
         * @type {Map<string, string[]>}
         */
        const personToLinkedPatientsMap = new Map();

        /**
         * @type {Map<string, import('../operations/query/filters/searchFilterFromReference').IReference>}
         */
        const personRefToPersonRefObj = new Map();

        let query = {
            $or: [
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
                            $elemMatch: {
                                system: SecurityTagSystem.owner,
                                code: {
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
            const linkedPerson = await linkedPersonCursor.nextObject();
            const allLinkedIds = this.getAllLinkedReferencesFromPerson(linkedPerson);
            personToLinkedPatientsMap.set(linkedPerson._uuid, allLinkedIds);

            if (asObject) {
                personRefToPersonRefObj.set(linkedPerson._uuid, {
                    id: linkedPerson._uuid,
                    resourceType: linkedPerson.resourceType,
                    sourceAssigningAuthority: linkedPerson._sourceAssigningAuthority
                });
            }
        }

        // build map of patient to person
        for (const [person, linkedReferences] of personToLinkedPatientsMap.entries()) {
            if (linkedReferences && linkedReferences.length > 0) {
                linkedReferences.forEach((currentReference) => {
                    const { id: patientId } = ReferenceParser.parseReference(currentReference);
                    if (!patientReferencesString.includes(currentReference) || patientId.startsWith('person.')) {
                        return;
                    }
                    const immediatePersons = patientReferenceToPersonUuid[patientId] || [];

                    if (asObject) {
                        immediatePersons.push(personRefToPersonRefObj.get(person));
                        patientReferenceToPersonUuid[patientId] = immediatePersons;
                    } else {
                        immediatePersons.push(person);
                        patientReferenceToPersonUuid[patientId] = immediatePersons;
                    }
                });
            }
        }

        return { patientReferenceToPersonUuid, personToLinkedPatientsMap };
    }

    /**
     * Gets intersection of all references & all references linked to the person
     * @param {Person} person
     * @return {string[]} references linked to given person
     */
    getAllLinkedReferencesFromPerson (person) {
        /** @type {string[]} */
        const allLinkedIds = [];

        /**
         * If person is not present or ids length is 0 or person link is not array
         * then return empty
         */
        if (!person || !person.link || !Array.isArray(person.link)) {
            return [];
        }

        /**
         * @type {PersonLink[]}
         * @description Array of links
        */
        const links = person.link;
        links.forEach((link) => {
            // check if reference is included in referencesToSearchFrom, then add it to array
            const reference = link?.target;
            if (reference && reference._uuid) {
                allLinkedIds.push(reference._uuid);
            }
        });

        return allLinkedIds;
    }

    /**
     * recursively search through links to find a bwell Person
     * @param {string} currentSubject
     * @param {DatabaseQueryManager} databaseQueryManager for performing queries
     * @param {Set} visitedSubjects subjects that have already been visited (to avoid infinite loops)
     * @return {Promise<string>}
     */
    async searchForBwellPersonAsync ({ currentSubject, databaseQueryManager, visitedSubjects }) {
        if (visitedSubjects.has(currentSubject)) {
            return null;
        }

        visitedSubjects.add(currentSubject);

        let foundPersonId = null;
        const isReferenceUuid = isUuid(currentSubject.replace(PERSON_REFERENCE_PREFIX, '').replace(PATIENT_REFERENCE_PREFIX, ''));
        const resourceReferenceKey = 'link.target.reference'.replace('reference', isReferenceUuid ? '_uuid' : '_sourceId');

        const linkedPersons = await databaseQueryManager.findAsync({ query: { [resourceReferenceKey]: currentSubject } });

        // iterate over linked Persons (breadth search)
        while (!foundPersonId && (await linkedPersons.hasNext())) {
            const nextPerson = await linkedPersons.nextObject();
            const nextPersonId = nextPerson._uuid;
            if (this.isBwellPerson(nextPerson)) {
                foundPersonId = nextPersonId;
            } else {
                // recurse through to next layer of linked Persons (depth search)
                foundPersonId = await this.searchForBwellPersonAsync({
                    currentSubject: `Person/${nextPersonId}`,
                    databaseQueryManager,
                    visitedSubjects
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
    isBwellPerson (person) {
        return person.meta.security &&
            person.meta.security.find(s => s.system === SecurityTagSystem.access && s.code === BwellMasterPersonCode) &&
            person.meta.security.find(s => s.system === SecurityTagSystem.owner && s.code === BwellMasterPersonCode);
    }
}

module.exports = {
    BwellPersonFinder
};
