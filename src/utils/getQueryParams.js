/**
 * This function return queryParam key value pair object from url
 * @param {string} url
 * @returns {Object}
 */
const getQueryParams = (url) => {
    return [...new URLSearchParams(url.split('?')[1])].reduce((result, [key, value]) => {
        if (value === 'true') {
            result[String(key)] = true;
        } else if (value === 'false') {
            result[String(key)] = false;
        } else if (value && !Number.isNaN(Number(value))) {
            result[String(key)] = Number(value);
        } else {
            result[String(key)] = value;
        }
        return result;
    }, {});
};

module.exports = {
    getQueryParams,
};
