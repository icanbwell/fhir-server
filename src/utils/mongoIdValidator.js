/**
 * Returns whether the given id is a valid Mongo ObjectId or not
 * @param {string} id
 * @returns {boolean}
 */
const { ObjectId } = require('mongodb');
module.exports.isValidMongoObjectId = function (id) {
    if (ObjectId.isValid(id)) {
        return (String)(new ObjectId(id)) === id;
    }
    return false;
};
