const async = require('async');
const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {PersonToPatientIdsExpander} = require('../../utils/personToPatientIdsExpander');
const {QueryParameterValue} = require('../../operations/query/queryParameterValue');

const patientReferencePrefix = 'Patient/';
const personProxyPrefix = 'person.';
const patientReferencePlusPersonProxyPrefix = `${patientReferencePrefix}${personProxyPrefix}`;


class PatientProxyQueryRewriter extends QueryRewriter {
    /**
     * constructor
     * @param {PersonToPatientIdsExpander} personToPatientIdsExpander
     */
    constructor(
        {
            personToPatientIdsExpander
        }
    ) {
        super();

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);
    }

    /**
     * rewrites the args
     * @param {string} base_version
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @return {Promise<ParsedArgs>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, parsedArgs, resourceType}) {
        assertIsValid(resourceType);
        assertIsValid(base_version);
        for (const parsedArg of parsedArgs.parsedArgItems) {
            if (resourceType === 'Patient') {
                if (parsedArg.queryParameter === 'id' || parsedArg.queryParameter === '_id') {
                    const queryParameterValues = parsedArg.queryParameterValue.values;
                    if (queryParameterValues.length > 0) {
                        if (queryParameterValues.some(
                            a => a.startsWith(personProxyPrefix) ||
                                a.startsWith(patientReferencePlusPersonProxyPrefix))
                        ) {
                            const patientProxyIds = await async.flatMapSeries(
                                queryParameterValues,
                                async a => a.startsWith(personProxyPrefix) ||
                                a.startsWith(patientReferencePlusPersonProxyPrefix) ?
                                    await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                                        {
                                            base_version,
                                            id: a,
                                            includePatientPrefix: false
                                        }) : a
                            );
                            parsedArg.queryParameterValue = new QueryParameterValue({
                                value: patientProxyIds,
                                operator: '$or'
                            });
                        }
                    }
                }
            } else { // resourceType other than Patient
                const queryParameterValues = parsedArg.queryParameterValue.values;
                if (queryParameterValues.length > 0) {
                    if (queryParameterValues.some(
                        a => typeof a === 'string' &&
                            a.startsWith(patientReferencePlusPersonProxyPrefix))) {
                        // replace with patient ids from person
                        const patientProxyIds = await async.flatMapSeries(
                            queryParameterValues,
                            async a => a.startsWith(patientReferencePlusPersonProxyPrefix) ?
                                await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                                    {
                                        base_version,
                                        id: a, includePatientPrefix: true
                                    }) : a
                        );
                        parsedArg.queryParameterValue = new QueryParameterValue({
                            value: patientProxyIds,
                            operator: '$or'
                        });
                    }
                }
            }
        }

        return parsedArgs;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
