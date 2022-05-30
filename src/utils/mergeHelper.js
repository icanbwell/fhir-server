const deepcopy = require('deepcopy');
const deepEqual = require('fast-deep-equal');
const deepmerge = require('deepmerge');

/**
 * @type {{customMerge: (function(*): *)}}
 */
const options = {
    customMerge: (/*key*/) => {
        // this requires a forward declaration since it uses recursion
        // eslint-disable-next-line no-use-before-define
        return mergeObjectOrArray;
    }
};

/**
 * Merges objects or array of objects
 * @param {?Object | Object[]} oldItem
 * @param {?Object | Object[]} newItem
 * @return {?Object | Object[]}
 */
const mergeObjectOrArray = (oldItem, newItem) => {
    if (deepEqual(oldItem, newItem)) {
        return oldItem;
    }
    if (oldItem === null) {
        return newItem;
    }
    if (newItem === null) {
        return oldItem;
    }
    // handle array merging
    if (Array.isArray(oldItem)) {
        /**
         * @type {Object[]}
         */
        let oldArray = oldItem;
        /**
         * @type {Object[]}
         */
        let newArray = newItem;
        // if this is an array of primitive types then just replace with new array
        if (oldArray.length > 0 && typeof oldArray[0] !== 'object' && newArray.length > 0) {
            return newArray;
        }

        // find all items with -delete in their id
        /**
         * @type {string[]}
         */
        const idsOfItemsToDelete = newArray
            .filter(n => n.id !== null && n.id.endsWith('-delete'))
            .map(n => n.id.slice(0, -7)); // get id without the -delete at the end
        // remove the "-delete" ids from newArray
        newArray = newArray.filter(n => (n.id === null || !n.id.endsWith('-delete')));
        // remove items with these ids from oldArray
        oldArray = oldArray.filter(o => (o.id === null || !(idsOfItemsToDelete.includes(o.id))));
        /**
         * @type {? Object[]}
         */
        let resultArray = null;
        // iterate through all the new array and find any items that are not present in old array
        for (const /** * @type {Object} */ newArrayItem of newArray) {
            if (newArrayItem === null) {
                continue;
            }

            // if newArray[i] does not match any item in oldArray then insert
            if (oldArray.every(oldArrayItem => deepEqual(oldArrayItem, newArrayItem) === false)) {
                // if 'id' is present then use that to find matching elements
                if (typeof newArrayItem === 'object' && 'id' in newArrayItem) {
                    // find item in oldArray array that matches this one by id
                    /**
                     * @type {number}
                     */
                    const matchingOldItemIndex = oldArray.findIndex(x => x['id'] === newArrayItem['id']);
                    if (matchingOldItemIndex > -1) {
                        // check if id column exists and is the same
                        //  then recurse down and merge that item
                        if (resultArray === null) {
                            resultArray = deepcopy(oldArray); // deep copy so we don't change the original object
                        }
                        // call deepmerge recursively to merge into items in this array
                        resultArray[`${matchingOldItemIndex}`] = deepmerge(
                            oldArray[`${matchingOldItemIndex}`], newArrayItem, options);
                        continue; // no need to continue and check sequence
                    }
                }
                // if 'sequence' is present then use that to find matching elements
                if (typeof newArrayItem === 'object' && 'sequence' in newArrayItem) {
                    /**
                     * @type {Object[]}
                     */
                    resultArray = [];
                    // go through the list until you find a sequence number that is greater than the new
                    // item and then insert before it
                    /**
                     * @type {number}
                     */
                    let index = 0;
                    /**
                     * @type {boolean}
                     */
                    let insertedItem = false;
                    while (index < oldArray.length) {
                        /**
                         * @type {Object}
                         */
                        const oldArrayItem = oldArray[`${index}`];
                        // if item has not already been inserted then insert before the next sequence
                        if (!insertedItem && (oldArrayItem['sequence'] > newArrayItem['sequence'])) {
                            resultArray.push(newArrayItem); // add the new item before
                            resultArray.push(oldArrayItem); // then add the old item
                            insertedItem = true;
                        } else {
                            resultArray.push(oldArrayItem); // just add the old item
                        }
                        index += 1;
                    }
                    if (!insertedItem) {
                        // if no sequence number greater than this was found then add at the end
                        resultArray.push(newArrayItem);
                    }
                } else {
                    // no sequence property is set on this item so just insert at the end
                    if (resultArray === null) {
                        resultArray = deepcopy(oldArray); // deep copy so we don't change the original object
                    }
                    resultArray.push(newArrayItem);
                }
            }
        }
        if (resultArray !== null) {
            return resultArray;
        } else {
            return oldArray;
        }
    }
    // if this is not an array then recurse down to merge
    return deepmerge(oldItem, newItem, options);
};

/**
 * merges two objects
 * @param {Object} old1
 * @param {Object} new1
 * @returns {Object}
 */
const mergeObject = (old1, new1) => {
    return deepmerge(old1, new1, options);
};

module.exports = {
    mergeObject: mergeObject
};

