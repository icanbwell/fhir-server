const async = require('async');
const {QueryRewriter} = require('./queryRewriter');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {PersonToPatientIdsExpander} = require('../../utils/personToPatientIdsExpander');

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
     * @param {ParsedArgsItem[]} parsedArgs
     * @param {string} resourceType
     * @return {Promise<ParsedArgsItem[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, parsedArgs, resourceType}) {
        assertIsValid(resourceType);
        assertIsValid(base_version);
        for (const parsedArg of parsedArgs) {
            if (resourceType === 'Patient') {
                if (parsedArg.queryParameter === 'id') {
                    if (Array.isArray(parsedArg.queryParameterValue)) {
                        if (parsedArg.queryParameterValue.some(
                            a => a.startsWith(personProxyPrefix) || a.startsWith(patientReferencePlusPersonProxyPrefix))
                        ) {
                            parsedArg.queryParameterValue = await async.flatMapSeries(
                                parsedArg.queryParameterValue,
                                async a => a.startsWith(personProxyPrefix) || a.startsWith(patientReferencePlusPersonProxyPrefix) ?
                                    await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                                        {
                                            base_version,
                                            id: a,
                                            includePatientPrefix: false
                                        }) : a
                            );
                        }
                    } else if (typeof argValue === 'string' && (
                        parsedArg.queryParameterValue.startsWith(personProxyPrefix) || parsedArg.queryParameterValue.startsWith(patientReferencePlusPersonProxyPrefix))) {
                        parsedArg.queryParameterValue = await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                            {
                                base_version,
                                id: parsedArg.queryParameterValue,
                                includePatientPrefix: false
                            });
                    }
                }
            } else { // resourceType other than Patient
                if (Array.isArray(parsedArg.queryParameterValue)) {
                    if (parsedArg.queryParameterValue.some(a => typeof parsedArg.queryParameterValue === 'string' && a.startsWith(patientReferencePlusPersonProxyPrefix))) {
                        // replace with patient ids from person
                        parsedArg.queryParameterValue = await async.flatMapSeries(
                            parsedArg.queryParameterValue,
                            async a => a.startsWith(patientReferencePlusPersonProxyPrefix) ?
                                await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                                    {
                                        base_version,
                                        id: a, includePatientPrefix: true
                                    }) : a
                        );
                    }
                } else if (typeof parsedArg.queryParameterValue === 'string' && parsedArg.queryParameterValue.startsWith(patientReferencePlusPersonProxyPrefix)) {
                    parsedArg.queryParameterValue = await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                        {
                            base_version,
                            id: parsedArg.queryParameterValue, includePatientPrefix: true
                        });
                }
            }
        }

        return parsedArgs;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
