const {assertTypeEquals} = require('./assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const {SecurityTagSystem} = require('./securityTagSystem');

const BwellMasterPersonCode = 'bwell';

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
        while (!foundPersonId && linkedPersons && await linkedPersons.hasNext()) {
            let nextPerson = await linkedPersons.next();

            if (nextPerson.meta.security.find(s => s.system === SecurityTagSystem.access && s.code === BwellMasterPersonCode) &&
                nextPerson.meta.security.find(s => s.system === SecurityTagSystem.owner && s.code === BwellMasterPersonCode)) {
                foundPersonId = nextPerson.id;
            }
            else {
                foundPersonId = await this.searchForBwellPersonAsync({
                    currentSubject: `Person/${nextPerson.id}`,
                    databaseQueryManager: databaseQueryManager,
                    visitedSubjects: visitedSubjects
                });
            }
        }

        return foundPersonId;
    }
}

module.exports = {
    BwellPersonFinder
};
