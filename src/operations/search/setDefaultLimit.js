const {limit, searchLimitForIds} = require('../../utils/searchForm.util');

/**
 * set default sort options
 * @param {Object} args
 * @param {Object} options
 */
function setDefaultLimit(args, options) {
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
