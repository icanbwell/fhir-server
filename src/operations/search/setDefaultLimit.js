const {limit} = require('../../utils/searchForm.util');

/**
 * set default sort options
 * @param {Object} args
 * @param {Object} options
 */
function setDefaultLimit(args, options) {
    if (!args['id'] && !args['_elements']) {
        // set a limit so the server does not come down due to volume of data
        options['limit'] = limit;
    }
}

module.exports = {
    setDefaultLimit: setDefaultLimit
};
