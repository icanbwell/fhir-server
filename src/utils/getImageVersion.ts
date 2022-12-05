const env = require('var');

function getImageVersion() {
    /**
     * @type {string}
     */
    const image = env.DOCKER_IMAGE || '';
    /**
     * @type {string|null}
     */
    const version = image ? image.slice(image.lastIndexOf(':') + 1) : null;
    return version;
}

module.exports = {
    getImageVersion
};
