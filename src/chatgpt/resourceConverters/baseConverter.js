class BaseConverter {
    /**
     * converts Patient resource to text
     * @param {Resource} resource
     * @returns {string}
     */
    // eslint-disable-next-line no-unused-vars
    convert({resource}) {
        throw new Error('Not Implemented by subclass');
    }
}

module.exports = {
    BaseConverter
};
