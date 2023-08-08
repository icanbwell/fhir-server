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
     * updates the queryParameters
     * @param {ParsedArgs} parsedArgs
     * @param {string} base_version
     * @param {boolean} includePatientPrefix
     * @returns {ParsedArgsItem}
     */
    async rewriteQueryParametersAsync({ parsedArg, base_version, includePatientPrefix }) {
        const queryParameterValues = parsedArg.queryParameterValue.values;
        if (queryParameterValues && queryParameterValues.length > 0) {
            /**
             * @type {string[]}
             */
            const queryParameterValuesToProcess = queryParameterValues.filter(a =>
                typeof a === 'string' && (
                    a.startsWith(patientReferencePlusPersonProxyPrefix) ||
                    (!includePatientPrefix && a.startsWith(personProxyPrefix))
                )
            );
            /**
             * @type {string[]}
             */
            const queryParameterValuesToNotProcess = queryParameterValues.filter(a =>
                !(typeof a === 'string' && (
                    a.startsWith(patientReferencePlusPersonProxyPrefix) ||
                    (!includePatientPrefix && a.startsWith(personProxyPrefix))
                ))
            );
            if (queryParameterValuesToProcess.length > 0) {
                /**
                 * @type {string[]}
                 */
                const patientProxyIds = await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                    {
                        base_version,
                        ids: queryParameterValuesToProcess,
                        includePatientPrefix
                    }
                );

                parsedArg.queryParameterValue = new QueryParameterValue({
                    value: [...patientProxyIds, ...queryParameterValuesToNotProcess],
                    operator: '$or'
                });
            }
        }
        return parsedArg;
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
        // const foo = undefined[1];

        if (parsedArgs?.parsedArgItems) {
            parsedArgs.parsedArgItems = await Promise.all(
                parsedArgs.parsedArgItems.map(async parsedArg => {
                    if (resourceType === 'Patient') {
                        if (parsedArg.queryParameter === 'id' || parsedArg.queryParameter === '_id') {
                            parsedArg = await this.rewriteQueryParametersAsync({
                                parsedArg,
                                base_version,
                                includePatientPrefix: false
                            });
                        }
                    } else { // resourceType other than Patient
                        parsedArg = await this.rewriteQueryParametersAsync({
                            parsedArg,
                            base_version,
                            includePatientPrefix: true
                        });
                    }
                    return parsedArg;
                })
            );
        }

        return parsedArgs;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
