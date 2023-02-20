const env = require('var');
const {ForbiddenError} = require('../../utils/httpErrors');
const {assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('../security/scopesManager');
const {AccessIndexManager} = require('./accessIndexManager');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {PatientFilterManager} = require('../../fhir/patientFilterManager');
const {isUuid} = require('../../utils/uid.util');

/**
 * This class manages queries for security tags
 */
class SecurityTagManager {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {AccessIndexManager} accessIndexManager
     * @param {PatientFilterManager} patientFilterManager
     */
    constructor({scopesManager, accessIndexManager, patientFilterManager}) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {AccessIndexManager}
         */
        this.accessIndexManager = accessIndexManager;
        assertTypeEquals(accessIndexManager, AccessIndexManager);

        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);
    }

    /**
     * returns security tags to filter by based on the scope
     * @param {string} user
     * @param {string} scope
     * @return {string[]}
     */
    getSecurityTagsFromScope({user, scope}) {
        /**
         * @type {string[]}
         */
        let securityTags = [];
        // add any access codes from scopes
        const accessCodes = this.scopesManager.getAccessCodesFromScopes('read', user, scope);
        if (env.AUTH_ENABLED === '1') {
            // fail if there are no access codes
            if (accessCodes.length === 0) {
                let errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
                throw new ForbiddenError(errorMessage);
            }
            // see if we have the * access code
            else if (accessCodes.includes('*')) {
                // no security check since user has full access to everything
            } else {
                securityTags = accessCodes;
            }
        }
        return securityTags;
    }

    /**
     * if there is already an $and statement then just add to it
     * @param {import('mongodb').Document} query
     * @param {import('mongodb').Document} andQuery
     * @return {import('mongodb').Document}
     */
    appendAndQuery(query, andQuery) {
        if (query.$and) {
            query.$and.push(
                andQuery
            );
            return query;
        } else if (Object.keys(query).length === 0) { // empty query then just replace
            return {
                $and: [
                    andQuery
                ]
            };
        } else {
            return {
                $and: [
                    query,
                    andQuery
                ]
            };
        }
    }

    /**
     * returns the passed query by adding a check for security tgs
     * @param {string} resourceType
     * @param {string[]} securityTags
     * @param {import('mongodb').Document} query
     * @param {boolean} useAccessIndex
     * @return {import('mongodb').Document}
     */
    getQueryWithSecurityTags(
        {
            resourceType, securityTags, query, useAccessIndex = false
        }
    ) {
        if (securityTags && securityTags.length > 0) {
            let securityTagQuery;
            // special handling for large collections for performance
            if (useAccessIndex &&
                this.accessIndexManager.resourceHasAccessIndexForAccessCodes(
                    {
                        resourceType,
                        accessCodes: securityTags
                    })
            ) {
                if (securityTags.length === 1) {
                    securityTagQuery = {[`_access.${securityTags[0]}`]: 1}; // optimize query for a single code
                } else {
                    securityTagQuery = {
                        $or: securityTags.map(s => {
                                return {[`_access.${s}`]: 1};
                            }
                        )
                    };
                }
            } else if (securityTags.length === 1) {
                securityTagQuery = {
                    'meta.security': {
                        '$elemMatch': {
                            'system': SecurityTagSystem.access,
                            'code': securityTags[0]
                        }
                    }
                };
            } else {
                securityTagQuery = {
                    'meta.security': {
                        '$elemMatch': {
                            'system': SecurityTagSystem.access,
                            'code': {
                                '$in': securityTags
                            }
                        }
                    }
                };
            }

            // if there is already an $and statement then just add to it
            query = this.appendAndQuery(query, securityTagQuery);
        }
        return query;
    }

    /**
     * Gets Patient Filter Query
     * @param {string[] | null} patientIds
     * @param {import('mongodb').Document} query
     * @param {string} resourceType
     * @return {import('mongodb').Document}
     */
    getQueryWithPatientFilter({patientIds, query, resourceType}) {
        if (!this.patientFilterManager.canAccessResourceWithPatientScope({resourceType})) {
            throw new ForbiddenError(`Resource type ${resourceType} cannot be accessed via a patient scope`);
        }
        // separate uuids from non-uuids
        const patientUuids = patientIds.filter(id => isUuid(id));
        if (patientUuids && patientUuids.length > 0) {
            const inQuery = {
                '$in': resourceType === 'Patient' ? patientUuids : patientUuids.map(p => `Patient/${p}`)
            };
            /**
             * @type {string|string[]|null}
             */
            const patientFilterProperty = this.patientFilterManager.getPatientPropertyForResource({
                resourceType
            });
            if (patientFilterProperty) {
                if (Array.isArray(patientFilterProperty)) {
                    /**
                     * @type {string[]}
                     */
                    const patientFilterList = patientFilterProperty;
                    const patientsQuery = {
                        '$or': patientFilterList.map(p => {
                                return {[p.replace('.reference', '._uuid')]: inQuery};
                            }
                        )
                    };
                    query = this.appendAndQuery(query, patientsQuery);
                } else {
                    const patientsQuery = {
                        [patientFilterProperty.replace('.reference', '._uuid')]: inQuery
                    };
                    query = this.appendAndQuery(query, patientsQuery);
                }
            }
        }
        const patientNonUuids = patientIds.filter(id => !isUuid(id));
        if (patientNonUuids && patientNonUuids.length > 0) {
            const inQuery = {
                '$in': resourceType === 'Patient' ? patientNonUuids : patientNonUuids.map(p => `Patient/${p}`)
            };
            /**
             * @type {string|string[]|null}
             */
            const patientFilterProperty = this.patientFilterManager.getPatientPropertyForResource({
                resourceType
            });
            if (patientFilterProperty) {
                if (Array.isArray(patientFilterProperty)) {
                    /**
                     * @type {string[]}
                     */
                    const patientFilterList = patientFilterProperty;
                    const patientsQuery = {
                        '$or': patientFilterList.map(p => {
                                return {[p.replace('.reference', '._sourceId')]: inQuery};
                            }
                        )
                    };
                    query = this.appendAndQuery(query, patientsQuery);
                } else {
                    const patientsQuery = {[patientFilterProperty.replace('.reference', '._sourceId')]: inQuery};
                    query = this.appendAndQuery(query, patientsQuery);
                }
            }
        }
        return query;
    }
}

module.exports = {
    SecurityTagManager
};
