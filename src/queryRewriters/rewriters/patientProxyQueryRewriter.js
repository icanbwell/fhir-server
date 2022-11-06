const {QueryRewriter} = require('./queryRewriter');

class PatientProxyQueryRewriter extends QueryRewriter {
    // eslint-disable-next-line no-unused-vars
    async rewriteAsync({base_version, query, columns}) {
        // see if there are any patient

        return {query, columns};
    }
}

module.exports = {
    PatientProxyQueryRewriter
};
