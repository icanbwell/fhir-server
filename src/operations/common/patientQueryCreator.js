const {ForbiddenError} = require('../../utils/httpErrors');
const {FieldMapper} = require('../query/filters/fieldMapper');
const {isUuid} = require('../../utils/uid.util');
const {assertTypeEquals} = require('../../utils/assertType');
const {PatientFilterManager} = require('../../fhir/patientFilterManager');
const {R4SearchQueryCreator} = require('../query/r4');
const {R4ArgsParser} = require('../query/r4ArgsParser');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const querystring = require('querystring');
const { OPERATIONS, RESOURCE_RESTRICTION_TAG } = require('../../constants');

class PatientQueryCreator {
    /**
     * constructor
     * @param {PatientFilterManager} patientFilterManager
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {R4ArgsParser} r4ArgsParser
     */
    constructor({patientFilterManager, r4SearchQueryCreator, r4ArgsParser}) {
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
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
    }

    /**
     * Narrows a query on a securityContext-owned resource type (Binary) to what a patient-scoped caller may
     * read. ANDed onto whatever filter (including the tenant access-tag filter) is already in the query,
     * never instead of it.
     *
     * "Owned by the caller" means the resource's securityContext is a Patient reference matching one of the
     * caller's patient ids: a real linked patient (`Patient/{uuid}`), or the person's proxy patient
     * (`Patient/person.{person_uuid}`) which getPatientIdsFromScopeAsync always includes. Matching follows the
     * same uuid / source-id split as getQueryWithPatientFilter.
     *
     * - no patient ids: fails closed ({_uuid: '__invalid__'}) when strict; otherwise only unowned resources
     * - strict (pure patient token, so no tenant filter exists): owned by the caller only; a resource with
     *   no securityContext is never returned
     * - otherwise (mixed token): owned by the caller, or not owned by anybody (no securityContext pointing
     *   at a Patient), so existing Binary read exactly as before; Binary owned by someone else are excluded
     * @typedef {Object} GetQueryWithPersonSecurityContextParams
     * @property {string[]|undefined} patientIds the caller's patient ids (see getPatientIdsFromScopeAsync)
     * @property {import('mongodb').Document} query
     * @property {string} resourceType
     * @property {boolean} useHistoryTable
     * @property {boolean} strict
     *
     * @param {GetQueryWithPersonSecurityContextParams}
     * @return {import('mongodb').Document}
     */
    getQueryWithPersonSecurityContext({patientIds, query, resourceType, useHistoryTable, strict}) {
        const property = this.patientFilterManager.getPersonSecurityContextProperty({resourceType});
        if (!property) {
            throw new ForbiddenError(`Resource type ${resourceType} is not owned through a securityContext`);
        }
        const fieldMapper = new FieldMapper({useHistoryTable});
        const uuidField = fieldMapper.getFieldName(property.replace('.reference', '._uuid'));
        const sourceIdField = fieldMapper.getFieldName(property.replace('.reference', '._sourceId'));
        const ids = (patientIds || []).filter(id => typeof id === 'string' && id.length > 0);
        /**
         * @type {import('mongodb').Document[]}
         */
        const ownedQueries = [];
        const uuids = ids.filter(id => isUuid(id)).map(id => `Patient/${id}`);
        if (uuids.length > 0) {
            ownedQueries.push({[uuidField]: {$in: uuids}});
        }
        const nonUuids = ids.filter(id => !isUuid(id)).map(id => `Patient/${id}`);
        if (nonUuids.length > 0) {
            ownedQueries.push({[sourceIdField]: {$in: nonUuids}});
        }
        /**
         * @type {import('mongodb').Document|null}
         */
        const ownedQuery = ownedQueries.length === 0
            ? null
            : (ownedQueries.length === 1 ? ownedQueries[0] : {$or: ownedQueries});
        let personQuery;
        if (strict) {
            personQuery = ownedQuery || {_uuid: '__invalid__'};
        } else {
            const unownedQuery = {
                $and: [
                    {[uuidField]: {$not: {$regex: '^Patient/'}}},
                    {[sourceIdField]: {$not: {$regex: '^Patient/'}}}
                ]
            };
            personQuery = ownedQuery ? {$or: [unownedQuery, ownedQuery]} : unownedQuery;
        }
        return this.r4SearchQueryCreator.appendAndSimplifyQuery({query, andQuery: personQuery});
    }

    /**
     * Gets Patient Filter Query
     * @param {string[] | null} patientIds
     * @param {string[] | null} personIds
     * @param {import('mongodb').Document} query
     * @param {string} resourceType
     * @param {boolean} useHistoryTable
     * @return {import('mongodb').Document}
     */
    getQueryWithPatientFilter({patientIds, query, resourceType, useHistoryTable, personIds}) {
        if (!this.patientFilterManager.canAccessResourceWithPatientScope({resourceType})) {
            throw new ForbiddenError(`Resource type ${resourceType} cannot be accessed via a patient scope`);
        }
        const fieldMapper = new FieldMapper({useHistoryTable});
        // create a list to hold all the queries
        /**
         * @type {import('mongodb').Document[]}
         */
        const queries = [];
        // separate uuids from non-uuids
        const patientUuids = patientIds ? patientIds.filter(id => isUuid(id)) : [];
        if (patientUuids && patientUuids.length > 0) {
            /**
             * @type {import('mongodb').Document}
             */
            let patientsUuidQuery;
            const inQuery = {
                $in: resourceType === 'Patient' ? patientUuids : patientUuids.map(p => `Patient/${p}`)
            };
            /**
             * @type {string|string[]|null}
             */
            const patientFilterProperty = this.patientFilterManager.getPatientPropertyForResource({
                resourceType
            });
            /**
             * @type {string|string[]|null}
             */
            const patientFilterWithQueryProperty = this.patientFilterManager.getPatientFilterQueryForResource({
                resourceType
            });
            if (patientFilterProperty) {
                if (Array.isArray(patientFilterProperty) && patientFilterProperty.length > 0) {
                    patientsUuidQuery = {
                        $or: patientFilterProperty.map(p => {
                                // if patient itself then search by _uuid
                                if (p === 'id') {
                                    return {[fieldMapper.getFieldName('_uuid')]: inQuery};
                                }
                                return {
                                    [fieldMapper.getFieldName(p.replace('.reference', '._uuid'))]: inQuery
                                };
                            }
                        )
                    };
                } else if (!Array.isArray(patientFilterProperty)) {
                    // if patient itself then search by _uuid
                    // noinspection IfStatementWithIdenticalBranchesJS
                    if (patientFilterProperty === 'id') {
                        patientsUuidQuery = {[fieldMapper.getFieldName('_uuid')]: inQuery};
                    } else {
                        patientsUuidQuery = {
                            [
                                fieldMapper.getFieldName(
                                    patientFilterProperty.replace('.reference', '._uuid')
                                )
                                ]: inQuery
                        };
                    }
                }
            } else if (patientFilterWithQueryProperty) {
                // replace patient with value of patient
                /**
                 * @type {ParsedUrlQuery}
                 */
                const args = querystring.parse(patientFilterWithQueryProperty);
                const propertyName = Object.keys(args)[0];
                args[propertyName] = patientUuids.map(p => args[propertyName].replace('{patient}', p));
                args.base_version = VERSIONS['4_0_0'];
                const parsedArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args,
                    useOrFilterForArrays: true
                });
                ({ query: patientsUuidQuery } = this.r4SearchQueryCreator.buildR4SearchQuery({
                    resourceType,
                    parsedArgs,
                    useHistoryTable,
                    operation: OPERATIONS.READ,
                    isUser: true
                }));
            }
            if (patientsUuidQuery) {
                queries.push(patientsUuidQuery);
            }
        }
        const patientNonUuids = patientIds ? patientIds.filter(id => !isUuid(id)) : [];
        if (patientNonUuids && patientNonUuids.length > 0) {
            /**
             * @type {import('mongodb').Document}
             */
            let patientsNonUuidQuery;
            const inQuery = {
                $in: resourceType === 'Patient' ? patientNonUuids : patientNonUuids.map(p => `Patient/${p}`)
            };
            /**
             * @type {string|string[]|null}
             */
            const patientFilterProperty = this.patientFilterManager.getPatientPropertyForResource({
                resourceType
            });
            /**
             * @type {string|string[]|null}
             */
            const patientFilterWithQueryProperty = this.patientFilterManager.getPatientFilterQueryForResource({
                resourceType
            });

            if (patientFilterProperty) {
                if (Array.isArray(patientFilterProperty) && patientFilterProperty.length > 0) {
                    patientsNonUuidQuery = {
                        $or: patientFilterProperty.map(p => {
                                // if patient itself then search by _sourceId
                                if (p === 'id') {
                                    return {[fieldMapper.getFieldName('_sourceId')]: inQuery};
                                }
                                return {
                                    [fieldMapper.getFieldName(p.replace('.reference', '._sourceId'))]: inQuery
                                };
                            }
                        )
                    };
                } else if (!Array.isArray(patientFilterProperty)) {
                    // if patient itself then search by _sourceId
                    // noinspection IfStatementWithIdenticalBranchesJS
                    if (patientFilterProperty === 'id') {
                        patientsNonUuidQuery = {[fieldMapper.getFieldName('_sourceId')]: inQuery};
                    } else {
                        patientsNonUuidQuery = {
                            [
                                fieldMapper.getFieldName(
                                    patientFilterProperty.replace('.reference', '._sourceId')
                                )
                                ]: inQuery
                        };
                    }
                }
            } else if (patientFilterWithQueryProperty) {
                // replace patient with value of patient
                /**
                 * @type {ParsedUrlQuery}
                 */
                const args = querystring.parse(patientFilterWithQueryProperty);
                const propertyName = Object.keys(args)[0];
                args[propertyName] = patientNonUuids.map(p => args[propertyName].replace('{patient}', p));
                args.base_version = VERSIONS['4_0_0'];
                const parsedArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args,
                    useOrFilterForArrays: true
                });
                ({ query: patientsNonUuidQuery } = this.r4SearchQueryCreator.buildR4SearchQuery({
                    resourceType,
                    parsedArgs,
                    useHistoryTable,
                    operation: OPERATIONS.READ,
                    isUser: true
                }));
            }
            if (patientsNonUuidQuery) {
                queries.push(patientsNonUuidQuery);
            }
        }

        // check if there are filters for person
        if (personIds && personIds.length > 0) {
            /**
             * @type {import('mongodb').Document}
             */
            let personsQuery;
            const inQuery = {
                $in: resourceType === 'Person' ? personIds : personIds.map(p => `Person/${p}`)
            };
            /**
             * @type {string|string[]|null}
             */
            const personFilterProperty = this.patientFilterManager.getPersonPropertyForResource({
                resourceType
            });
            /**
             * @type {string|string[]|null}
             */
            const personFilterWithQueryProperty = this.patientFilterManager.getPersonFilterQueryForResource({
                resourceType
            });
            if (personFilterProperty) {
                if (Array.isArray(personFilterProperty)) {
                    personsQuery = {
                        $or: personFilterProperty.map(p => {
                                // if patient itself then search by _uuid
                                if (p === 'id') {
                                    return {[fieldMapper.getFieldName('_uuid')]: inQuery};
                                }
                                return {
                                    [fieldMapper.getFieldName(p.replace('.reference', '._uuid'))]: inQuery
                                };
                            }
                        )
                    };
                } else {
                    // if patient itself then search by _uuid
                    // noinspection IfStatementWithIdenticalBranchesJS
                    if (personFilterProperty === 'id') {
                        personsQuery = {[fieldMapper.getFieldName('_uuid')]: inQuery};
                    } else {
                        personsQuery = {
                            [
                                fieldMapper.getFieldName(
                                    personFilterProperty.replace('.reference', '._uuid')
                                )
                                ]: inQuery
                        };
                    }
                }
            } else if (personFilterWithQueryProperty) {
                // replace patient with value of patient
                /**
                 * @type {ParsedUrlQuery}
                 */
                const args = querystring.parse(personFilterWithQueryProperty);
                const propertyName = Object.keys(args)[0];
                args[propertyName] = personIds.map(p => args[propertyName].replace('{person}', p));
                args.base_version = VERSIONS['4_0_0'];
                const parsedArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args,
                    useOrFilterForArrays: true
                });
                ({ query: personsQuery } = this.r4SearchQueryCreator.buildR4SearchQuery({
                    resourceType,
                    parsedArgs,
                    useHistoryTable,
                    operation: OPERATIONS.READ,
                    isUser: true
                }));
            }
            if (personsQuery) {
                queries.push(personsQuery);
            }
        }
        // if no queries found then don't allow access
        if (queries.length === 0) {
            return {_uuid: '__invalid__'}; // return nothing since no valid query was found
        }
        // Now combine all the queries into one
        const patientAndPersonQuery = {
            $or: queries
        };
        // run simplifier to simplify the query
        if (patientAndPersonQuery) {
            query = this.r4SearchQueryCreator.appendAndSimplifyQuery({query, andQuery: patientAndPersonQuery});
        }

        query = this.applyCommonPatientFilters({query});

        return query;
    }

    /**
     * Apply common Patient Filters to Query
     * @param {import('mongodb').Document} query
     * @return {import('mongodb').Document}
     */
    applyCommonPatientFilters({query}) {
        // apply filter to exclude resources with restricted security
        query.$and = query.$and || [];
        query.$and.push({
            'meta.security': {
                $not: {
                    $elemMatch: {
                        system: RESOURCE_RESTRICTION_TAG.SYSTEM,
                        code: RESOURCE_RESTRICTION_TAG.CODE
                    }
                }
            }
        });
        return query;
    }
}

module.exports = {
    PatientQueryCreator
};
