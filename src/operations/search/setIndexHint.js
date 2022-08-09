const {findIndexForFields} = require('../../indexes/indexHinter');
const {logDebug} = require('../common/logging');

/**
 * sets the index hint
 * @param {string|null} indexHint
 * @param {string} mongoCollectionName
 * @param {Set} columns
 * @param {DatabasePartitionedCursor} cursor
 * @param {string | null} user
 * @return {{cursor: DatabasePartitionedCursor, indexHint: (string|null)}}
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
    setIndexHint
};
