function getImageVersion () {
    /**
     * @type {string}
     */
    const image = process.env.DOCKER_IMAGE || '';
    /**
     * @type {string|null}
     */
    return process.env.DOCKER_IMAGE_VERSION || (image ? image.slice(image.lastIndexOf(':') + 1) : null);
}

module.exports = {
    getImageVersion
};
