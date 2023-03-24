const {LENIENT_SEARCH_HANDLING} = require('../../constants');
/**
 * combines args with args from request
 * @param {import('http').IncomingMessage} req
 * @param {Object} args
 * @returns {Object} array of combined arguments
 */
module.exports.get_all_args = (req, args) => {
    // our query processor hides certain query parameters from us so we need to get them from the context
    const query_param_args = {};
    /**
     * args array
     * @type {[string][]}
     */
    const query_args_array = Object.entries(req.query);
    query_args_array.forEach(x => {
        query_param_args[x[0]] = x[1];
    });

    const sanitized_args = {};
    const sanitized_args_array = Object.entries(req.sanitized_args);
    sanitized_args_array.forEach(x => {
        sanitized_args[x[0]] = x[1];
    });

    // Handling specifies the type of search to be conducted strict or lenient
    // https://www.hl7.org/fhir/search.html#errors
    args['handling'] = req.headers['handling'] ? req.headers['handling'] : LENIENT_SEARCH_HANDLING;

    return Object.assign({}, args, sanitized_args, query_param_args);
};
