const env = require('var');

function getImageVersion() {
    /**
     * @type {string}
     */
    const image = env.DOCKER_IMAGE || '';
    /**
     * @type {string|null}
     */
    return image ? image.slice(image.lastIndexOf(':') + 1) : null;
}

module.exports = {
    getImageVersion
};
