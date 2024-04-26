const { ForbiddenError } = require('../../utils/httpErrors');
const { FieldMapper } = require('../query/filters/fieldMapper');
const { isUuid } = require('../../utils/uid.util');
const { assertTypeEquals } = require('../../utils/assertType');
const { PatientFilterManager } = require('../../fhir/patientFilterManager');
const { R4SearchQueryCreator } = require('../query/r4');
const { R4ArgsParser } = require('../query/r4ArgsParser');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const querystring = require('querystring');

class PatientQueryCreator {
    /**
     * constructor
     * @param {PatientFilterManager} patientFilterManager
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     * @param {R4ArgsParser} r4ArgsParser
     */
    constructor ({ patientFilterManager, r4SearchQueryCreator, r4ArgsParser }) {
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
     * @param {import('mongodb').Document} query
     * @param {string} resourceType
     * @param {boolean} useHistoryTable
     * @return {import('mongodb').Document}
     */
    getQueryWithPatientFilter ({ patientIds, query, resourceType, useHistoryTable }) {
        if (!this.patientFilterManager.canAccessResourceWithPatientScope({ resourceType })) {
            throw new ForbiddenError(`Resource type ${resourceType} cannot be accessed via a patient scope`);
        }
        const fieldMapper = new FieldMapper({ useHistoryTable });
        // separate uuids from non-uuids
        const patientUuids = patientIds.filter(id => isUuid(id));
        let patientsUuidQuery, patientsNonUuidQuery;
        if (patientUuids && patientUuids.length > 0) {
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
            const patientFilterWithQueryProperty = this.patientFilterManager.getFilterQueryForResource({
                resourceType
            });
            if (patientFilterProperty) {
                if (Array.isArray(patientFilterProperty)) {
                    patientsUuidQuery = {
                        $or: patientFilterProperty.map(p => {
                                // if patient itself then search by _uuid
                                if (p === 'id') {
                                    return { [fieldMapper.getFieldName('_uuid')]: inQuery };
                                }
                                return {
                                    [fieldMapper.getFieldName(p.replace('.reference', '._uuid'))]: inQuery
                                };
                            }
                        )
                    };
                } else {
                    // if patient itself then search by _uuid
                    if (patientFilterProperty === 'id') {
                        patientsUuidQuery = { [fieldMapper.getFieldName('_uuid')]: inQuery };
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
                args.identifier = patientUuids.map(p => args.identifier.replace('{patient}', p));
                args.base_version = VERSIONS['4_0_0'];
                const parsedArgs = this.r4ArgsParser.parseArgs({
                    resourceType,
                    args,
                    useOrFilterForArrays: true
                });
                ({ query: patientsUuidQuery } = this.r4SearchQueryCreator.buildR4SearchQuery({
                    resourceType, parsedArgs, useHistoryTable
                }));
            }
        }
        const patientNonUuids = patientIds.filter(id => !isUuid(id));
        if (patientNonUuids && patientNonUuids.length > 0) {
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
                                    return { [fieldMapper.getFieldName('_sourceId')]: inQuery };
                                }
                                return {
                                    [fieldMapper.getFieldName(p.replace('.reference', '._sourceId'))]: inQuery
                                };
                            }
                        )
                    };
                } else {
                    // if patient itself then search by _sourceId
                    if (patientFilterProperty === 'id') {
                        patientsNonUuidQuery = { [fieldMapper.getFieldName('_sourceId')]: inQuery };
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
        }
        let patientsQuery;
        if (patientsUuidQuery && patientsNonUuidQuery) {
            patientsQuery = {
                $or: [patientsUuidQuery, patientsNonUuidQuery]
            };
        } else if (patientsUuidQuery || patientsNonUuidQuery) {
            patientsQuery = patientsUuidQuery || patientsNonUuidQuery;
        }
        if (patientsQuery) {
            query = this.r4SearchQueryCreator.appendAndSimplifyQuery(query, patientsQuery);
        }
        return query;
    }
}

module.exports = {
    PatientQueryCreator
};
