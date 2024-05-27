const {ForbiddenError} = require('../../utils/httpErrors');
const {FieldMapper} = require('../query/filters/fieldMapper');
const {isUuid} = require('../../utils/uid.util');
const {assertTypeEquals} = require('../../utils/assertType');
const {PatientFilterManager} = require('../../fhir/patientFilterManager');
const {R4SearchQueryCreator} = require('../query/r4');
const {R4ArgsParser} = require('../query/r4ArgsParser');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const querystring = require('querystring');
const {OPERATIONS} = require('../../constants');

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
        const patientUuids = patientIds.filter(id => isUuid(id));
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
                if (Array.isArray(patientFilterProperty)) {
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
                } else {
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
                // TODO: don't hardcode extension here.  Use name of property from above
                args.extension = patientUuids.map(p => args.extension.replace('{patient}', p));
                args.base_version = VERSIONS['4_0_0'];
                const parsedArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args,
                    useOrFilterForArrays: true
                });
                ({query: patientsUuidQuery} = this.r4SearchQueryCreator.buildR4SearchQuery({
                    resourceType, parsedArgs, useHistoryTable,
                    operation: OPERATIONS.READ
                }));
            }
            if (patientsUuidQuery) {
                queries.push(patientsUuidQuery);
            }
        }
        const patientNonUuids = patientIds.filter(id => !isUuid(id));
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
            if (patientFilterProperty) {
                if (Array.isArray(patientFilterProperty)) {
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
                } else {
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
                // TODO: don't hardcode 'extension' here.  Use name of property from above
                args.extension = patientUuids.map(p => args.extension.replace('{person}', p));
                args.base_version = VERSIONS['4_0_0'];
                const parsedArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args,
                    useOrFilterForArrays: true
                });
                ({query: personsQuery} = this.r4SearchQueryCreator.buildR4SearchQuery({
                    resourceType, parsedArgs, useHistoryTable,
                    operation: OPERATIONS.READ
                }));
            }
            if (personsQuery) {
                queries.push(personsQuery);
            }
        }

        // Now combine all the queries into one
        const patientAndPersonQuery = {
                $or: queries
            };
        // run simplifier to simplify the query
        if (patientAndPersonQuery) {
            query = this.r4SearchQueryCreator.appendAndSimplifyQuery({query, andQuery: patientAndPersonQuery});
        }
        return query;
    }
}

module.exports = {
    PatientQueryCreator
};
