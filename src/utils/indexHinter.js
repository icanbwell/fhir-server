const {customIndexes} = require('./customIndexes');

/**
 * check if two arrays have same elements
 * @param {string[]} arrOne
 * @param {string[]} arrTwo
 * @return {boolean}
 */
function arrayEquals(arrOne, arrTwo) {
    return arrOne.every(function (element) {
        return arrTwo.includes(element);
    });
}

/**
 * find index for given collection and fields
 * @param {string} collection_name
 * @param {string[]} fields
 * @return {string|null}
 */
function findIndexForFields(collection_name, fields) {
    for (const [collection, indexesArray] of Object.entries(customIndexes)) {
        if (collection === '*' || collection === collection_name) {
            for (const indexDefinition of indexesArray) {
                for (const [indexName, indexColumns] of Object.entries(indexDefinition)) {
                    if (arrayEquals(indexColumns, fields)) {
                        return indexName;
                    }
                }
            }
        }
    }
    return null;
}

module.exports = {
    findIndexForFields
};
