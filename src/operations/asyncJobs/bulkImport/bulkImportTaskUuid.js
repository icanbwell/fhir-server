const { BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY } = require('../../../constants');
const { isUuid, generateUUIDv5 } = require('../../../utils/uid.util');

/**
 * Derives the stored `_uuid` of a bulk-import Task from the id the client supplied to $import.
 * A uuid id is used as is; any other id is hashed with the bwell source assigning authority.
 * Task creation and every later Task lookup must use this so they address the same document.
 * @param {string} id
 * @returns {string}
 */
const getBulkImportTaskUuid = (id) =>
    isUuid(id) ? id : generateUUIDv5(`${id}|${BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY}`);

module.exports = { getBulkImportTaskUuid };
