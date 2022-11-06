const async = require('async');
const {QueryRewriter} = require('./queryRewriter');

class PatientProxyQueryRewriter extends QueryRewriter {
    /**
     * rewrites the args
     * @param {Object} args
     * @return {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async rewriteArgsAsync({args}) {
        const personProxyPrefix = 'Patient/person.';

        for (const [
            /** @type {string} */ argName,
            /** @type {string|string[]} */ argValue
        ] of Object.entries(args)) {
            if (Array.isArray(argValue)) {
                if (argValue.some(a => a.startsWith(personProxyPrefix))) {
                    args[`${argName}`] = await async.mapSeries(
                        argValue,
                        async a => a.startsWith(personProxyPrefix) ? await this.fixPatientProxy({id: a}) : a
                    );
                }
            } else if (typeof argValue === 'string' && argValue.startsWith(personProxyPrefix)) {
                args[`${argName}`] = await this.fixPatientProxy({id: argValue});
            }
        }
        return args;
    }

    /**
     * replaces patient proxy with actual patient ids
     * @param {string} id
     * @return {Promise<string>}
     */
    async fixPatientProxy({id}) {
        return id;
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
