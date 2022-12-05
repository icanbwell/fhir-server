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
     * @param {Object} args
     * @param {string} resourceType
     * @return {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({base_version, args, resourceType}) {
        assertIsValid(resourceType);
        assertIsValid(base_version);
        for (const [
            /** @type {string} */ argName,
            /** @type {string|string[]} */ argValue
        ] of Object.entries(args)) {
            if (resourceType === 'Patient') {
                if (argName === 'id') {
                    if (Array.isArray(argValue)) {
                        if (argValue.some(a => a.startsWith(personProxyPrefix) || a.startsWith(patientReferencePlusPersonProxyPrefix))) {
                            args[`${argName}`] = await async.mapSeries(
                                argValue,
                                async a => a.startsWith(personProxyPrefix) || a.startsWith(patientReferencePlusPersonProxyPrefix) ?
                                    await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                                        {
                                            base_version,
                                            id: a,
                                            includePatientPrefix: false
                                        }) : a
                            );
                            args[`${argName}`] = args[`${argName}`].join(',');
                        }
                    } else if (typeof argValue === 'string' && (argValue.startsWith(personProxyPrefix) || argValue.startsWith(patientReferencePlusPersonProxyPrefix))) {
                        args[`${argName}`] = await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                            {
                                base_version,
                                id: argValue,
                                includePatientPrefix: false
                            });
                    }
                }
            } else { // resourceType other than Patient
                if (Array.isArray(argValue)) {
                    if (argValue.some(a => typeof argValue === 'string' && a.startsWith(patientReferencePlusPersonProxyPrefix))) {
                        // replace with patient ids from person
                        args[`${argName}`] = await async.mapSeries(
                            argValue,
                            async a => a.startsWith(patientReferencePlusPersonProxyPrefix) ?
                                await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                                    {
                                        base_version,
                                        id: a, includePatientPrefix: true
                                    }) : a
                        );
                        args[`${argName}`] = args[`${argName}`].join(',');
                    }
                } else if (typeof argValue === 'string' && argValue.startsWith(patientReferencePlusPersonProxyPrefix)) {
                    args[`${argName}`] = await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                        {
                            base_version,
                            id: argValue, includePatientPrefix: true
                        });
                }
            }
        }

        return args;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
