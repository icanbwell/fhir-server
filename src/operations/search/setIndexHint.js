const {findIndexForFields} = require('../../indexes/indexHinter');
const {logDebug} = require('../common/logging');

/**
 * sets the index hint
 * @param {string|null} indexHint
 * @param {string} mongoCollectionName
 * @param {Set} columns
 * @param {Promise<Cursor<unknown>> | *} cursor
 * @param {string | null} user
 * @return {{cursor: Promise<Cursor<unknown>> | *, indexHint: (string|null)}}
 */
function setIndexHint(indexHint, mongoCollectionName, columns, cursor, user) {
    indexHint = findIndexForFields(mongoCollectionName, Array.from(columns));
    if (indexHint) {
        cursor = cursor.hint(indexHint);
        logDebug(
            user,
            `Using index hint ${indexHint} for columns [${Array.from(columns).join(',')}]`
        );
    }
    return {indexHint, cursor};
}

module.exports = {
    setIndexHint: setIndexHint
};
