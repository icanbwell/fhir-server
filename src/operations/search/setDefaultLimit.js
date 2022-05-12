const {limit, searchLimitForIds} = require('../../utils/searchForm.util');

/**
 * set default sort options
 * @param {Object} args
 * @param {Object} options
 * @param {boolean} isStreaming
 */
function setDefaultLimit(args, options, isStreaming) {
    if (isStreaming) {
        return; //don't set any limits when streaming since we send data as we get from mongo so no mem pressure
    }
    // set a limit so the server does not come down due to volume of data
    if (!args['id'] && !args['_elements']) {
        options['limit'] = limit;
    } else {
        options['limit'] = searchLimitForIds;
    }
}

module.exports = {
    setDefaultLimit: setDefaultLimit
};
