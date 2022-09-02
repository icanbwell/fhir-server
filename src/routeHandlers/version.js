/**
 * This route handler implements the /version endpoint which returns the current version of the code
 */

const env = require('var');
const { getImageVersion } = require('../utils/getImageVersion');
module.exports.handleVersion = (req, res) => {
    const image = env.DOCKER_IMAGE || '';
    if (image) {
        return res.json({ version: getImageVersion(), image: image });
    } else {
        return res.json({ version: 'unknown', image: 'unknown' });
    }
};
