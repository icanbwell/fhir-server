const moment = require('moment-timezone');

/**
 * Parses a single date and determine what the comparator is.  The regex
 * will attempt to parse the FHIR date with and without prefix and ISO date.
 *
 * @param {*} date
 */
function parseDate (date) {
    // supports date formats with prefix
    const regex = /(^\D\D)?([\d-Tt:+]+)([\d: ]+)?/;
    const match = date.match(regex);
    let prefix = '$eq';

    // match[1] = prefix
    // match[2] = date string
    // match[3] = positive offset if there is one
    if (match && match.length >= 3) {
        if (match[1]) {
            // replace prefix with mongo specific comparators
            prefix = '$' + match[1].replace('ge', 'gte').replace('le', 'lte');
        }
        let dateStr = match[2];
        // if match[3] then there url has stripped out the + in date
        if (match[3] !== null && match[3] !== undefined) {
            dateStr += match[3].replace(' ', '+');
        }

        // return in desired ISO format
        return { [prefix]: moment.utc(dateStr).format('YYYY-MM-DDTHH:mm:ssZ') };
    } else {
        return { [prefix]: moment.utc(date).format('YYYY-MM-DDTHH:mm:ssZ') };
    }
}

/**
 * Validates the date(s) and return the object containing the prefix and date.
 *
 * Prefix may contain 'ge, le, lt, gt'.
 *
 * @param {*} dates
 */
const validateDate = function (dates) {
    let parsedDate = {};
    if (dates) {
        // dates could be comma delimited if passed in more than one
        const dateArr = dates.split(',');
        if (dateArr) {
            for (const date in dateArr) {
                parsedDate = Object.assign(parsedDate, parseDate(dateArr[`${date}`]));
            }
        }
    }

    return parsedDate;
};

/**
 * Gets number of days between two dates
 * @param {Date} start
 * @param {Date} end
 * @returns {boolean}
 */
function isUTCDayDifferent (start, end) {
    return start.getUTCDay() !== end.getUTCDay();
}

// @TODO Update these, validateDate will always return something truthy and current
// implementation checks the result to create a query, if given no dates, this could
// create a query that returns unexpected results
module.exports = {
    validateDate,
    isUTCDayDifferent
};
