const { ForbiddenError } = require('../../utils/httpErrors');
const { assertTypeEquals } = require('../../utils/assertType');
const { ScopesManager } = require('../security/scopesManager');
const { AccessIndexManager } = require('./accessIndexManager');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { FieldMapper } = require('../query/filters/fieldMapper');
const { R4SearchQueryCreator } = require('../query/r4');
const { ConfigManager } = require('../../utils/configManager');

/**
 * This class manages queries for security tags
 */
class SecurityTagManager {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {AccessIndexManager} accessIndexManager
     * @param {PatientFilterManager} patientFilterManager
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {ConfigManager} configManager
     */
    constructor ({ scopesManager, accessIndexManager, patientFilterManager, r4SearchQueryCreator, configManager }) {
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

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        /**
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * returns security tags to filter by based on the scope
     * @param {string} user
     * @param {string} scope
     * @param {boolean} accessViaPatientScopes
     * @param {string} accessRequested
     * @return {string[]}
     */
    getSecurityTagsFromScope ({ user, scope, accessViaPatientScopes, accessRequested }) {
        /**
         * @type {string[]}
         */
        let securityTags = [];

        if (!this.configManager.authEnabled) {
            return securityTags;
        }
        // add any access codes from scopes
        const accessCodes = this.scopesManager.getAccessCodesFromScopes(accessRequested, user, scope);
        // fail if there are no access codes unless we have a patient limiting scope
        if (accessCodes.length === 0 && !accessViaPatientScopes) {
            const errorMessage = 'user ' + user + ' with scopes [' + scope + '] has no access scopes';
            throw new ForbiddenError(errorMessage);
        } else if (accessCodes.includes('*')) {
            // see if we have the * access code
            // no security check since user has full access to everything
        } else {
            securityTags = accessCodes;
        }
        return securityTags;
    }

    /**
     * returns the passed query by adding a check for security tgs
     * @param {string} resourceType
     * @param {string[]} securityTags
     * @param {import('mongodb').Document} query
     * @param {boolean} useAccessIndex
     * @param {boolean} useHistoryTable
     * @return {import('mongodb').Document}
     */
    getQueryWithSecurityTags ({
                                 resourceType, securityTags, query, useAccessIndex = false, useHistoryTable
                             }) {
        const fieldMapper = new FieldMapper({ useHistoryTable });
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
                    securityTagQuery = {
                        [fieldMapper.getFieldName(`_access.${securityTags[0]}`)]: 1
                    }; // optimize query for a single code
                } else {
                    securityTagQuery = {
                        $or: securityTags.map(s => ({
                            [fieldMapper.getFieldName(`_access.${s}`)]: 1
                        }))
                    };
                }
            } else if (securityTags.length === 1) {
                securityTagQuery = {
                    [fieldMapper.getFieldName('meta.security')]: {
                        $elemMatch: {
                            system: SecurityTagSystem.access,
                            code: securityTags[0]
                        }
                    }
                };
            } else {
                securityTagQuery = {
                    [fieldMapper.getFieldName('meta.security')]: {
                        $elemMatch: {
                            system: SecurityTagSystem.access,
                            code: {
                                $in: securityTags
                            }
                        }
                    }
                };
            }

            // if there is already an $and statement then just add to it
            query = this.r4SearchQueryCreator.appendAndSimplifyQuery({ query, andQuery: securityTagQuery });
        }
        return query;
    }
}

module.exports = {
    SecurityTagManager
};
