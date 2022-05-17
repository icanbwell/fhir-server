/**
 * converts a mongo query to string
 * @param {Object} obj
 * @returns {string|undefined}
 */
const mongoQueryStringify = (obj) => {

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


    if (ignoreDataTypes(obj)) {
        return undefined;
    }

    if (isDate(obj)) {
        return `"${obj.toISOString()}"`;
    }

    if (nullDataTypes(obj)) {
        return `${null}`;
    }

    if (isSymbol(obj)) {
        return undefined;
    }


    if (restOfDataTypes(obj)) {
        const passQuotes = isString(obj) ? '"' : '';
        return `${passQuotes}${obj}${passQuotes}`;
    }

    if (isArray(obj)) {
        let arrStr = '';
        obj.forEach((eachValue) => {
            arrStr += arrayValuesNullTypes(eachValue) ? mongoQueryStringify(null) : mongoQueryStringify(eachValue);
            arrStr += ',';
        });

        return '[' + removeComma(arrStr) + ']';
    }

    if (isObject(obj)) {

        let objStr = '';

        const objKeys = Object.keys(obj);

        objKeys.forEach((eachKey) => {
            const eachValue = obj[`${eachKey}`];
            objStr += (!ignoreDataTypes(eachValue)) ? `"${eachKey}":${mongoQueryStringify(eachValue)},` : '';
        });
        return '{' + removeComma(objStr) + '}';
    }
};

module.exports = {
    mongoQueryStringify: mongoQueryStringify
};
