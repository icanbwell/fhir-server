const assert = require('node:assert/strict');
/**
 * converts a mongo query to string
 * @param {Object} query
 * @returns {string|undefined}
 */
const mongoQueryStringify = (query) => {

    const isArray = (value) => {
        return Array.isArray(value) && typeof value === 'object';
    };

    const isObject = (value) => {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    };

    const isString = (value) => {
        return typeof value === 'string';
    };

    const isBoolean = (value) => {
        return typeof value === 'boolean';
    };

    const isNumber = (value) => {
        return typeof value === 'number';
    };

    const isNull = (value) => {
        return value === null && typeof value === 'object';
    };

    const isNotNumber = (value) => {
        return typeof value === 'number' && isNaN(value);
    };

    const isInfinity = (value) => {
        return typeof value === 'number' && !isFinite(value);
    };

    const isDate = (value) => {
        return typeof value === 'object' && value !== null && typeof value.getMonth === 'function';
    };

    const isUndefined = (value) => {
        return value === undefined && typeof value === 'undefined';
    };

    const isFunction = (value) => {
        return typeof value === 'function';
    };

    const isSymbol = (value) => {
        return typeof value === 'symbol';
    };

    const restOfDataTypes = (value) => {
        return isNumber(value) || isString(value) || isBoolean(value);
    };

    const ignoreDataTypes = (value) => {
        return isUndefined(value) || isFunction(value) || isSymbol(value);
    };

    const nullDataTypes = (value) => {
        return isNotNumber(value) || isInfinity(value) || isNull(value);
    };

    const arrayValuesNullTypes = (value) => {
        return isNotNumber(value) || isInfinity(value) || isNull(value) || ignoreDataTypes(value);
    };

    const removeComma = (str) => {
        const tempArr = str.split('');
        tempArr.pop();
        return tempArr.join('');
    };

    const isRegExp = (value) => {
        return value instanceof RegExp;
    };

    if (ignoreDataTypes(query)) {
        return undefined;
    }

    if (isDate(query)) {
        return `ISODate('${query.toISOString()}')`;
    }

    if (nullDataTypes(query)) {
        return `${null}`;
    }

    if (isSymbol(query)) {
        return undefined;
    }


    if (restOfDataTypes(query)) {
        const passQuotes = isString(query) ? "'" : '';
        return `${passQuotes}${query}${passQuotes}`;
    }

    if (isRegExp(query)) {
        return `'${query.source}'`;
    }

    if (isArray(query)) {
        let arrStr = '';
        query.forEach((eachValue) => {
            arrStr += arrayValuesNullTypes(eachValue) ? mongoQueryStringify(null) : mongoQueryStringify(eachValue);
            arrStr += ',';
        });

        return '[' + removeComma(arrStr) + ']';
    }

    if (isObject(query)) {

        let objStr = '';

        const objKeys = Object.keys(query);

        objKeys.forEach((eachKey) => {
            const eachValue = query[`${eachKey}`];
            objStr += (!ignoreDataTypes(eachValue)) ? `'${eachKey}':${mongoQueryStringify(eachValue)},` : '';
        });
        return '{' + removeComma(objStr) + '}';
    }
};

/**
 * converts a mongo query to string
 * @param {string} collectionName
 * @param {import('mongodb').Document} query
 * @param {import('mongodb').FindOneOptions} options
 * @returns {string|undefined}
 */
const mongoQueryAndOptionsStringifySingleQuery = (
    collectionName,
    query,
    options
) => {
    assert(!Array.isArray(query));
    assert(!Array.isArray(options));
    const queryText = mongoQueryStringify(query);
    const projection = options.projection ? options.projection : {};
    let result = `db.${collectionName}.find(${queryText}, ${mongoQueryStringify(projection)})`;
    if (options.sort) {
        result += `.sort(${mongoQueryStringify(options.sort)})`;
    }
    if (options.skip) {
        result += `.skip(${options.skip})`;
    }
    if (options.limit) {
        result += `.limit(${options.limit})`;
    }
    return result;
};

/**
 * converts a mongo query to string
 * @param {string} collectionName
 * @param {import('mongodb').Document | import('mongodb').Document[]} query
 * @param {import('mongodb').FindOneOptions | import('mongodb').FindOneOptions[]} options
 * @returns {string|undefined}
 */
const mongoQueryAndOptionsStringify = (
    collectionName,
    query,
    options
) => {
    if (Array.isArray(query)) {
        let result = '';
        query.forEach((queryItem, index) => {
            const optionsItem = options[`${index}`];
            const queryText = mongoQueryAndOptionsStringifySingleQuery(collectionName, queryItem, optionsItem);
            result += (index === 0) ? `${queryText} ` : ` | ${queryText}`;
        });
        return result;
    } else {
        return mongoQueryAndOptionsStringifySingleQuery(collectionName, query, options);
    }
};


module.exports = {
    mongoQueryStringify: mongoQueryStringify,
    mongoQueryAndOptionsStringify: mongoQueryAndOptionsStringify
};
