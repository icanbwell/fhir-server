/**
 * @param {Resource} resource
 * @returns {Promise<Resource>}
 */
const preSave = async function (resource) {
    return resource;
};

module.exports = {
    preSave: preSave,
};
