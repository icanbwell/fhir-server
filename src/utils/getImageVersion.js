const env = require('var');

function getImageVersion() {
    /**
     * @type {string}
     */
    const image = env.DOCKER_IMAGE || '';
    /**
     * @type {string|null}
     */
    return env.DD_VERSION || env.DOCKER_IMAGE_VERSION || (image ? image.slice(image.lastIndexOf(':') + 1) : null);
}

module.exports = {
    getImageVersion
};
