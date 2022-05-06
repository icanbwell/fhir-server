const {getSecurityTagsFromScope, getQueryWithSecurityTags} = require('../common/getSecurityTags');
const {buildStu3SearchQuery} = require('../query/stu3');
const {buildDstu2SearchQuery} = require('../query/dstu2');
const {buildR4SearchQuery} = require('../query/r4');
const {VERSIONS} = require('@asymmetrik/node-fhir-server-core').constants;

/**
 * constructs a mongo query
 * @param {string | null} user
 * @param {string | null} scope
 * @param {Object?} args
 * @param {string} resourceName
 * @param {string} collectionName
 * @returns {{base_version, columns: Set, query: import('mongodb').Document}}
 */
function constructQuery(user, scope, args, resourceName, collectionName) {
    /**
     * @type {string[]}
     */
    let securityTags = getSecurityTagsFromScope(user, scope);
    /**
     * @type {string}
     */
    let {base_version} = args;
    /**
     * @type {import('mongodb').Document}
     */
    let query;

    /**
     * @type {Set}
     */
    let columns;

    // eslint-disable-next-line no-useless-catch
    try {
        if (base_version === VERSIONS['3_0_1']) {
            query = buildStu3SearchQuery(args);
        } else if (base_version === VERSIONS['1_0_2']) {
            query = buildDstu2SearchQuery(args);
        } else {
            ({query, columns} = buildR4SearchQuery(resourceName, args));
        }
    } catch (e) {
        throw e;
    }
    query = getQueryWithSecurityTags(collectionName, securityTags, query);
    return {base_version, query, columns};
}


module.exports = {
    constructQuery: constructQuery
};
