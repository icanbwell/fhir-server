function stringifyFilter(key, value) {
    if (value instanceof RegExp) {
        return value.toString();
    }

    return value;
}

module.exports = {
    stringifyFilter
};
