/**
 * @callback FnKeyCallback
 * @param {Object} x
 * @return {string}
 */

/**
 * @param {Object[]} listToCheck
 * @param {FnKeyCallback} fnKey
 * @returns {Object[]}
 */
const findDuplicates = (listToCheck, fnKey) => {
    // https://stackoverflow.com/questions/53212020/get-list-of-duplicate-objects-in-an-array-of-objects
    /**
     * @type {Object}
     */
    const lookup_by_id = listToCheck.reduce((a, e) => {
        a[fnKey(e)] = ++a[fnKey(e)] || 0;
        return a;
    }, {});
    return listToCheck.filter(e => lookup_by_id[fnKey(e)]);
};

/**
 * @param {Object[]} listToCheck
 * @param {FnKeyCallback} fnKey
 * @returns {Object[]}
 */
const findUniques = (listToCheck, fnKey) => {
    // https://stackoverflow.com/questions/53212020/get-list-of-duplicate-objects-in-an-array-of-objects
    /**
     * @type {Object}
     */
    const lookup_by_id = listToCheck.reduce((a, e) => {
        a[fnKey(e)] = ++a[fnKey(e)] || 0;
        return a;
    }, {});
    return listToCheck.filter(e => !lookup_by_id[fnKey(e)]);
};

/**
 * @param {Resource[]} listToCheck
 * @returns {Resource[]}
 */
const findDuplicateResources = (listToCheck) => {
    // noinspection JSValidateTypes
    return findDuplicates(listToCheck, r => `${r.resourceType}/${r._uuid}`);
};

/**
 * @param {Resource[]} listToCheck
 * @returns {Resource[]}
 */
const findUniqueResources = (listToCheck) => {
    // noinspection JSValidateTypes
    return findUniques(listToCheck, r => `${r.resourceType}/${r._uuid}`);
};

/**
 * https://stackoverflow.com/questions/14446511/most-efficient-method-to-groupby-on-an-array-of-objects
 * @param {*[]} sourceArray
 * @param {string} key
 * @return {*}
 */
const groupBy = function (sourceArray, key) { // `sourceArray` is an array of objects, `key` is the key (or property accessor) to group by
    // reduce runs this anonymous function on each element of `sourceArray` (the `item` parameter,
    // returning the `storage` parameter at the end
    return sourceArray.reduce(function (storage, item) {
        // get the first instance of the key by which we're grouping
        const group = item[`${key}`];

        // set `storage` for this instance of group to the outer scope (if not empty) or initialize it
        storage[`${group}`] = storage[`${group}`] || [];

        // add this item to its group within `storage`
        storage[`${group}`].push(item);

        // return the updated storage to the reduce function, which will then loop through the next
        return storage;
    }, {}); // {} is the initial value of the storage
};

/**
 * @callback FnGroupCallback
 * @param {*} x
 * @return {string}
 */

/**
 * Groups an array using the provided lambda function to get the key
 * https://stackoverflow.com/questions/14446511/most-efficient-method-to-groupby-on-an-array-of-objects
 * @param {Object[]} sourceArray
 * @param {FnGroupCallback} fnKey
 * @return {Object}
 */
const groupByLambda = function (sourceArray, fnKey) { // `sourceArray` is an array of objects, `key` is the key (or property accessor) to group by
    // reduce runs this anonymous function on each element of `sourceArray` (the `item` parameter,
    // returning the `storage` parameter at the end
    return sourceArray.reduce(function (storage, item) {
        // get the first instance of the key by which we're grouping
        const group = fnKey(item);

        // set `storage` for this instance of group to the outer scope (if not empty) or initialize it
        storage[`${group}`] = storage[`${group}`] || [];

        // add this item to its group within `storage`
        storage[`${group}`].push(item);

        // return the updated storage to the reduce function, which will then loop through the next
        return storage;
    }, {}); // {} is the initial value of the storage
};

/**
 * Gets the first element in an array if exists else returns null
 * @param {Object[]} sourceArray
 * @return {Object | null}
 */
const getFirstElementOrNull = (sourceArray) => sourceArray.length === 0 ? null : sourceArray[0];

/**
 * Gets the first element in an array if exists else returns null
 * @param {Resource[]} sourceArray
 * @return {Resource | null}
 */
const getFirstResourceOrNull = (sourceArray) => sourceArray.length === 0 ? null : sourceArray[0];

/**
 * Gets the first element in an array if exists else returns null
 * @param {BundleEntry[]} sourceArray
 * @return {BundleEntry | null}
 */
const getFirstBundleEntryOrNull = (sourceArray) => sourceArray.length === 0 ? null : sourceArray[0];

/**
 * @param {(*[])[]} array_of_arrays
 * @returns {Promise<*>}
 */
async function removeEmptyEntriesAsync(array_of_arrays) {
    return array_of_arrays.filter(a => a.length > 0);
}

/**
 * removes duplicate items from array
 * @param {*[]} array
 * @param fnCompare
 * @returns {*[]}
 */
function removeDuplicatesWithLambda(array, fnCompare)
{
    return array.filter((value, index, self) => index === self.findIndex((t) => (fnCompare(t, value))));
}


module.exports = {
    findDuplicates,
    findDuplicateResources,
    findUniques,
    findUniqueResources,
    groupBy,
    groupByLambda,
    getFirstElementOrNull,
    getFirstResourceOrNull,
    getFirstBundleEntryOrNull,
    removeEmptyEntriesAsync,
    removeDuplicatesWithLambda
};
