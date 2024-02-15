const { QueryRewriter } = require('./queryRewriter');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { PersonToPatientIdsExpander } = require('../../utils/personToPatientIdsExpander');
const { QueryParameterValue } = require('../../operations/query/queryParameterValue');
const { isTrueWithFallback } = require('../../utils/isTrue');
const { ConfigManager } = require('../../utils/configManager');

const patientReferencePrefix = 'Patient/';
const personProxyPrefix = 'person.';
const patientReferencePlusPersonProxyPrefix = `${patientReferencePrefix}${personProxyPrefix}`;

class PatientProxyQueryRewriter extends QueryRewriter {
    /**
     * @typedef {object} PatientProxyQueryRewriterProps
     * @property {ConfigManager} configManager
     * @property {PersonToPatientIdsExpander} personToPatientIdsExpander
     * constructor
     * @param {PatientProxyQueryRewriterProps} params
     */
    constructor (
        {
            personToPatientIdsExpander,
            configManager
        }
    ) {
        super();

        /**
         * @type {PersonToPatientIdsExpander}
         */
        this.personToPatientIdsExpander = personToPatientIdsExpander;
        assertTypeEquals(personToPatientIdsExpander, PersonToPatientIdsExpander);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * updates the queryParameters
     * @param {ParseArgsItem} parsedArgs
     * @param {string} base_version
     * @param {boolean} includePatientPrefix
     * @param {boolean} cachePatientToPersonMap
     * @returns {ParsedArgsItem}
     */
    async rewriteQueryParametersAsync ({ parsedArg, base_version, includePatientPrefix, cachePatientToPersonMap }) {
        const queryParameterValues = parsedArg.queryParameterValue.values;
        if (queryParameterValues && queryParameterValues.length > 0) {
            /**
             * @type {{queryParametersWithProxyPatientIds: string[], queryParametersWithoutProxyPatientIds: string[]}}
             */
            const { queryParametersWithProxyPatientIds, queryParametersWithoutProxyPatientIds } =
                queryParameterValues.reduce((queryParametersMap, queryParameterValue) => {
                    if (typeof queryParameterValue === 'string' && (
                        // either person.id or Patient/person.id
                        queryParameterValue.startsWith(patientReferencePlusPersonProxyPrefix) ||
                        (queryParameterValue.startsWith(personProxyPrefix))
                    )) {
                        queryParametersMap.queryParametersWithProxyPatientIds.push(queryParameterValue);
                    } else {
                        queryParametersMap.queryParametersWithoutProxyPatientIds.push(queryParameterValue);
                    }
                    return queryParametersMap;
                }, {
                    queryParametersWithProxyPatientIds: [],
                    queryParametersWithoutProxyPatientIds: []
                });

            if (queryParametersWithProxyPatientIds.length > 0) {
                /**
                 * @type {{[k: string]: string[]}}
                 */
                const patientProxyMap = await this.personToPatientIdsExpander.getPatientProxyIdsAsync(
                    {
                        base_version,
                        ids: queryParametersWithProxyPatientIds,
                        includePatientPrefix,
                        toMap: true
                    }
                );

                 /** @type {{[k: string]: string}} */
                const patientToPersonMap = {};

                /** @type {string[]} */
                const patientProxyIds = [];
                Object.entries(patientProxyMap).forEach(([personId, ids]) => {
                    patientProxyIds.push(...ids);

                    if (cachePatientToPersonMap) {
                        ids.forEach((id) => {
                            patientToPersonMap[`${id}`] = personId;
                        });
                    }
                });

                parsedArg.queryParameterValue = new QueryParameterValue({
                    value: [...patientProxyIds, ...queryParametersWithoutProxyPatientIds],
                    operator: '$or'
                });

                if (cachePatientToPersonMap) {
                    // assign the map here
                    parsedArg.patientToPersonMap = patientToPersonMap;
                }
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
    async rewriteArgsAsync ({ base_version, parsedArgs, resourceType }) {
        assertIsValid(resourceType);
        assertIsValid(base_version);
        // const foo = undefined[1];
        const cachePatientToPersonMap = isTrueWithFallback(parsedArgs['_rewritePatientReference'], this.configManager.rewritePatientReference);
        if (parsedArgs?.parsedArgItems) {
            parsedArgs.parsedArgItems = await Promise.all(
                parsedArgs.parsedArgItems.map(async parsedArg => {
                    if (resourceType === 'Patient') {
                        if (parsedArg.queryParameter === 'id' || parsedArg.queryParameter === '_id') {
                            parsedArg = await this.rewriteQueryParametersAsync({
                                parsedArg,
                                base_version,
                                includePatientPrefix: false,
                                cachePatientToPersonMap
                            });
                        }
                    } else { // resourceType other than Patient
                        parsedArg = await this.rewriteQueryParametersAsync({
                            parsedArg,
                            base_version,
                            includePatientPrefix: true,
                            cachePatientToPersonMap
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
