const {getAccessCodesFromScopes} = require('../security/scopes');
const env = require('var');
const {ForbiddenError} = require('../../utils/httpErrors');
const {resourceHasAccessIndex} = require('./resourceHasAccessIndex');
const {profiles} = require('../../profiles');
/**
 * returns security tags to filter by based on the scope
 * @param {string} user
 * @param {string} scope
 * @return {string[]}
 */
const getSecurityTagsFromScope = ({user, scope}) => {
    /**
     * @type {string[]}
     */
    let securityTags = [];
    // add any access codes from scopes
    const accessCodes = getAccessCodesFromScopes('read', user, scope);
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
};

// if there is already an $and statement then just add to it
const appendAndQuery = (query, andQuery) => {
    if (query.$and) {
        query.$and.push(
            andQuery
        );
        return query;
    } else {
        return {
            $and: [
                query,
                andQuery
            ]
        };
    }
};

/**
 * returns the passed query by adding a check for security tgs
 * @param {string} resourceType
 * @param {string[]} securityTags
 * @param {Object} query
 * @param {boolean} useAccessIndex
 * @return {Object}
 */
const getQueryWithSecurityTags = (
    {
        resourceType, securityTags, query, useAccessIndex = false
    }
) => {
    if (securityTags && securityTags.length > 0) {
        let securityTagQuery;
        // special handling for large collections for performance
        if (useAccessIndex && resourceHasAccessIndex(resourceType)) {
            if (securityTags.length === 1) {
                securityTagQuery = {[`_access.${securityTags[0]}`]: 1};
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
                        'system': 'https://www.icanbwell.com/access',
                        'code': securityTags[0]
                    }
                }
            };
        } else {
            securityTagQuery = {
                'meta.security': {
                    '$elemMatch': {
                        'system': 'https://www.icanbwell.com/access',
                        'code': {
                            '$in': securityTags
                        }
                    }
                }
            };
        }

        // if there is already an $and statement then just add to it
        query = appendAndQuery(query, securityTagQuery);
    }
    return query;
};

/**
 * Gets Patient Filter Query
 * @param {string[] | null} patients
 * @param query
 * @param {string} resourceType
 * @return {{$and}|*|{$and: [*,*]}}
 */
const getQueryWithPatientFilter = ({patients, query, resourceType}) => {
    if (patients) {
        const inQuery = {
            '$in': resourceType === 'Patient' ? patients : patients.map(p => `Patient/${p}`)
        };
        /*
        * Patients are filtered on id. For some reason, AllergyIntolerance and Immunization don't have a subject field
        * like other Clinical Resources, filter on patient.reference. All other fields are filtered on subject.reference.
        * */
        let profile = profiles[`${resourceType}`];
        if (profile.filterByPerson) {
            const patientsQuery = {[profile.filterBy]: inQuery};
            query = appendAndQuery(query, patientsQuery);
        }
    }
    return query;
};

module.exports = {
    getSecurityTagsFromScope,
    getQueryWithSecurityTags,
    getQueryWithPatientFilter,
};
