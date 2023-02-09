/**
 * This file implements helpers for building mongo queries
 */


const moment = require('moment-timezone');
const {escapeRegExp} = require('./regexEscaper');
/**
 * @name stringQueryBuilder
 * @description builds mongo default query for string inputs, no modifiers
 * @param {string} target what we are querying for
 * @return a mongo regex query
 */
const stringQueryBuilder = function ({target}) {
    // noinspection RegExpDuplicateCharacterInClass
    const t2 = target.replace(/[\\(\\)\\-\\_\\+\\=\\/\\.]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp
    return {$regex: new RegExp('^' + escapeRegExp(t2), 'i')};
};

/**
 * @name addressQueryBuilder
 * @description brute force method of matching addresses. Splits the input and checks to see if every piece matches to
 * at least 1 part of the address field using regexs. Ignores case
 * @param {string} target
 * @return {array} ors
 */
const addressQueryBuilder = function ({target}) {
    // Tokenize the input as mush as possible
    const totalSplit = target.split(/[\s,]+/);
    const ors = [];
    for (const index in totalSplit) {
        /**
         * @type {string}
         */
        const regExPattern = totalSplit[`${index}`];
        /**
         * @type {RegExp}
         */
            // eslint-disable-next-line security/detect-non-literal-regexp
        const regExpObject = new RegExp(escapeRegExp(regExPattern), 'i');
        ors.push({
            $or: [
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'address.line': {$regex: regExpObject}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'address.city': {$regex: regExpObject}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'address.district': {$regex: regExpObject}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'address.state': {$regex: regExpObject}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'address.postalCode': {$regex: regExpObject}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'address.country': {$regex: regExpObject}},
            ],
        });
    }
    return ors;
};

/**
 * @name nameQueryBuilder
 * @description brute force method of matching human names. Splits the input and checks to see if every piece matches to
 * at least 1 part of the name field using regexs. Ignores case
 * @param {string} target
 * @return {array} ors
 */
const nameQueryBuilder = function ({target}) {
    const split = target.split(/[\s.,]+/);
    const ors = [];

    for (const i in split) {
        /**
         * @type {RegExp}
         */
            // eslint-disable-next-line security/detect-non-literal-regexp
        const regExpObject = new RegExp(escapeRegExp(split[`${i}`]));
        ors.push({
            $or: [
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'name.text': {$regex: regExpObject, '$options': 'i'}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'name.family': {$regex: regExpObject, '$options': 'i'}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'name.given': {$regex: regExpObject, '$options': 'i'}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'name.suffix': {$regex: regExpObject, '$options': 'i'}},
                // eslint-disable-next-line security/detect-non-literal-regexp
                {'name.prefix': {$regex: regExpObject, '$options': 'i'}},
            ],
        });
    }
    return ors;
};

/**
 * @name tokenQueryBuilder
 * @param {?string} target what we are searching for
 * @param {string} type codeable concepts use a code field and identifiers use a value
 * @param {string} field path to system and value from field
 * @param {string|undefined} [required] the required system if specified
 * @param {boolean|undefined} [exists_flag] whether to check for existence
 * @return {JSON} queryBuilder
 * Using to assign a single variable:
 *      const queryBuilder = tokenQueryBuilder(identifier, 'value', 'identifier');
 for (const i in queryBuilder) {
			 query[i] = queryBuilder[i];
		}
 * Use in an or query
 *      query.$or = [tokenQueryBuilder(identifier, 'value', 'identifier'), tokenQueryBuilder(type, 'code', 'type.coding')];
 */
const tokenQueryBuilder = function ({target, type, field, required, exists_flag}) {
    let queryBuilder = {};
    let system = '';
    let value;

    if (target === null || exists_flag === false) {
        queryBuilder[`${field}`] = {$exists: false};
        return queryBuilder;
    }
    if (exists_flag === true) {
        queryBuilder[`${field}`] = {$exists: true};
        return queryBuilder;
    }

    if (target.includes('|')) {
        [system, value] = target.split('|');

    } else {
        value = target;
    }

    if (required) {
        system = required;
    }

    const queryBuilderElementMatch = {};
    if (system) {
        queryBuilder[`${field}.system`] = system;
        queryBuilderElementMatch['system'] = system;
    }

    if (value) {
        if (value.includes(',')) {
            const values = value.split(',');
            queryBuilder[`${field}.${type}`] = {
                $in: values
            };
            queryBuilderElementMatch[`${type}`] = {
                $in: values
            };
        } else {
            queryBuilder[`${field}.${type}`] = value;
            queryBuilderElementMatch[`${type}`] = value;
        }
    }

    if (system && value) {
        // $elemMatch so we match on BOTH system and value in the same array element
        queryBuilder = {};
        queryBuilder[`${field}`] = {$elemMatch: queryBuilderElementMatch};
    }
    return queryBuilder;
};

/**
 * @name exactMatchQueryBuilder
 * @param {string|boolean|null} target what we are searching for
 * @param {string} field path to system and value from field
 * @param {boolean|undefined} [exists_flag] whether to check for existence
 * @return {JSON} queryBuilder
 * Using to assign a single variable:
 *      const queryBuilder = tokenQueryBuilder(identifier, 'value', 'identifier');
 for (const i in queryBuilder) {
			 query[i] = queryBuilder[i];
		}
 * Use in an or query
 *      query.$or = [tokenQueryBuilder(identifier, 'value', 'identifier'), tokenQueryBuilder(type, 'code', 'type.coding')];
 */
const exactMatchQueryBuilder = function ({target, field, exists_flag}) {
    const queryBuilder = {};
    let value;

    if (target === null || exists_flag === false) {
        queryBuilder[`${field}`] = {$exists: false};
        return queryBuilder;
    }
    if (exists_flag === true) {
        queryBuilder[`${field}`] = {$exists: true};
        return queryBuilder;
    }

    value = target;

    if (value !== undefined) {
        if (typeof value === 'string' && value.includes(',')) {
            const values = value.split(',');
            queryBuilder[`${field}`] = {
                $in: values
            };
        } else {
            queryBuilder[`${field}`] = value;
        }
    }

    return queryBuilder;
};

/**
 * @name referenceQueryBuilder
 * @param {string} target_type
 * @param {string} target
 * @param {string} field
 * @param {boolean|undefined} [exists_flag]
 * @return {JSON} queryBuilder
 */
const referenceQueryBuilder = function ({target_type, target, field, exists_flag}) {
    const queryBuilder = {};
    // noinspection JSIncompatibleTypesComparison
    if (target === null || exists_flag === false) {
        queryBuilder[`${field}`] = {$exists: false};
        return queryBuilder;
    }
    if (exists_flag === true) {
        queryBuilder[`${field}`] = {$exists: true};
        return queryBuilder;
    }
    if (target_type && target) {
        queryBuilder[`${field}`] = `${target_type}/${target}`;
        return queryBuilder;
    }
    // eslint-disable-next-line security/detect-unsafe-regex
    const regex = /http(.*)?\/(\w+\/.+)$/;
    const match = target.match(regex);

    // Check if target is a url
    if (match) {
        queryBuilder[`${field}`] = match[2];
    }
    // target = type/id
    else if (target.includes(',')) { // list was passed
        const searchItems = target.split(',');
        const fullResourceTypeAndIdList = [];
        for (const searchItem of searchItems) {
            if (searchItem.includes('/')) {
                const [type, id] = searchItem.split('/');
                fullResourceTypeAndIdList.push(`${type}/${id}`);
            } else {
                fullResourceTypeAndIdList.push(`${target_type}/${searchItem}`);
            }
        }
        queryBuilder[`${field}`] = {$in: fullResourceTypeAndIdList.map(s => `${s}`)};
    } else if (target.includes('/')) {
        const [type, id] = target.split('/');
        if (id.includes(',')) {
            const idList = id.split(',');
            queryBuilder[`${field}`] = {$in: idList.map(i => `${type}/${i}`)};
        } else {
            queryBuilder[`${field}`] = `${type}/${id}`;
        }
    }
    // target = id The type may be there so we need to check the end of the field for the id
    else {
        // eslint-disable-next-line security/detect-non-literal-regexp
        queryBuilder[`${field}`] = {$regex: new RegExp(escapeRegExp(`${target}$`))};
    }

    return queryBuilder;
};


/**
 * @name referenceQueryBuilder
 * @param {string} target_type
 * @param {string} target
 * @param {string} field
 * @param {string|undefined} sourceAssigningAuthorityField
 * @param {boolean|undefined} [exists_flag]
 * @return {JSON} queryBuilder
 */
const referenceQueryBuilderOptimized = function (
    {
        target_type,
        target,
        field,
        sourceAssigningAuthorityField,
        exists_flag
    }
) {
    const queryBuilder = {};
    // noinspection JSIncompatibleTypesComparison
    if (target === null || exists_flag === false) {
        queryBuilder[`${field}`] = {$exists: false};
        return queryBuilder;
    }
    if (exists_flag === true) {
        queryBuilder[`${field}`] = {$exists: true};
        return queryBuilder;
    }
    if (target_type && target) {
        const targetPlusSourceAssigningAuthority = target.split('|');
        if (targetPlusSourceAssigningAuthority.length > 1) {
            queryBuilder['$and'] = [
                {
                    [`${sourceAssigningAuthorityField}`]: targetPlusSourceAssigningAuthority[1]
                },
                {
                    [`${field}`]: `${target_type}/${targetPlusSourceAssigningAuthority[0]}`
                }
            ];
        } else {
            queryBuilder[`${field}`] = `${target_type}/${target}`;
        }
        return queryBuilder;
    }
    // eslint-disable-next-line security/detect-unsafe-regex
    const regex = /http(.*)?\/(\w+\/.+)$/;
    const match = target.match(regex);

    // Check if target is a url
    if (match) {
        queryBuilder[`${field}`] = match[2];
    }
    // target = type/id
    else if (target.includes(',')) { // list was passed
        const searchItems = target.split(',');
        const fullResourceTypeAndIdList = [];
        for (const searchItem of searchItems) {
            if (searchItem.includes('/')) {
                const [type, id] = searchItem.split('/');
                fullResourceTypeAndIdList.push(`${type}/${id}`);
            } else {
                fullResourceTypeAndIdList.push(`${target_type}/${searchItem}`);
            }
        }
        queryBuilder[`${field}`] = {$in: fullResourceTypeAndIdList.map(s => `${s}`)};
    } else if (target.includes('/')) {
        const [type, id] = target.split('/');
        if (id.includes(',')) {
            const idList = id.split(',');
            queryBuilder[`${field}`] = {$in: idList.map(i => `${type}/${i}`)};
        } else {
            queryBuilder[`${field}`] = `${type}/${id}`;
        }
    }
    // target = id The type may be there so we need to check the end of the field for the id
    else {
        // eslint-disable-next-line security/detect-non-literal-regexp
        queryBuilder[`${field}`] = {$regex: new RegExp(escapeRegExp(`${target}$`))};
    }

    return queryBuilder;
};

/**
 * @name numberQueryBuilder
 * @description takes in number query and returns a mongo query. The target parameter can have a 2 constter prefix to
 *              specify a specific kind of query. Else, an approximation query will be returned.
 * @param {string} target
 * @returns {Object} a mongo query
 */
const numberQueryBuilder = function ({target}) {
    let prefix = '';
    let number;
    let sigfigs;

    // Check if there is a prefix
    if (Number.isNaN(target)) {
        prefix = target.substring(0, 2);
        number = parseFloat(target.substring(2));
        sigfigs = target.substring(2);
    } else {
        number = parseFloat(target);
        sigfigs = target;
    }

    // Check for prefix and return the appropriate query
    // Missing eq(default), sa, eb, and ap prefixes
    switch (prefix) {
        case 'lt':
            return {$lt: number};
        case 'le':
            return {$lte: number};
        case 'gt':
            return {$gt: number};
        case 'ge':
            return {$gte: number};
        case 'ne':
            return {$ne: number};
    }

    // Return an approximation query
    let decimals = sigfigs.split('.')[1];
    if (decimals) {
        decimals = decimals.length + 1;
    } else {
        decimals = 1;
    }
    const aprox = (1 / 10 ** decimals) * 5;

    return {$gte: number - aprox, $lt: number + aprox};
};

/**
 * @name quantityQueryBuilder
 * @description builds quantity data types
 * @param {string} target [prefix][number]|[system]|[code]
 * @param {string} field path to specific field in the resource
 */
const quantityQueryBuilder = function ({target, field}) {
    const qB = {};
    //split by the two pipes
    let [num, system, code] = target.split('|');

    if (system) {
        qB[`${field}.system`] = system;
    }
    if (code) {
        qB[`${field}.code`] = code;
    }

    if (Number.isNaN(num)) {
        //with prefixes
        const prefix = num.substring(0, 2);
        num = Number(num.substring(2));

        // Missing eq(default), sa, eb, and ap prefixes
        switch (prefix) {
            case 'lt':
                qB[`${field}.value`] = {$lt: num};
                break;
            case 'le':
                qB[`${field}.value`] = {$lte: num};
                break;
            case 'gt':
                qB[`${field}.value`] = {$gt: num};
                break;
            case 'ge':
                qB[`${field}.value`] = {$gte: num};
                break;
            case 'ne':
                qB[`${field}.value`] = {$ne: num};
                break;
        }
    } else {
        //no prefixes
        qB[`${field}.value`] = Number(num);
    }

    return qB;
};

//for modular arithmetic because % is just for remainder -> JS is a cruel joke
function mod(n, m) {
    return ((n % m) + m) % m;
}

//gives the number of days from year 0, used for adding or subtracting days from a date
const getDayNum = function (year, month, day) {
    month = mod(month + 9, 12);
    year = year - Math.floor(month / 10);
    return (
        365 * year +
        Math.floor(year / 4) -
        Math.floor(year / 100) +
        Math.floor(year / 400) +
        Math.floor((month * 306 + 5) / 10) +
        (day - 1)
    );
};

//returns a date given the number of days from year 0;
const getDateFromNum = function (days) {
    let year = Math.floor((10000 * days + 14780) / 3652425);
    let day2 =
        days - (365 * year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400));
    if (day2 < 0) {
        year = year - 1;
        day2 =
            days - (365 * year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400));
    }
    const m1 = Math.floor((100 * day2 + 52) / 3060);
    const month = mod(m1 + 2, 12) + 1;
    year = year + Math.floor((m1 + 2) / 12);
    const rDay = day2 - Math.floor((m1 * 306 + 5) / 10) + 1;
    return year.toString() + '-' + ('0' + month).slice(-2) + '-' + ('0' + rDay).slice(-2);
};


/**
 * Builds a date query
 * deals with date, dateTime, instant, period, and timing
 * use like this: query['whatever'] = dateQueryBuilder(whatever, 'dateTime'), but it's different for period and timing
 * the condition service has some examples you might want to look at.
 * can't handle prefixes yet!
 * Also doesn't work for when things are stored in different time zones in the .json files (with the + or -)
 *   UNLESS, the search parameter is teh exact same as what is stored.  So, if something is stored as 2016-06-03T05:00-03:00, then the search parameter must be 2016-06-03T05:00-03:00
 * It's important to make sure formatting is right, don't forget a leading 0 when dealing with single digit times.
 * @param {string} date
 * @param {string} type
 * @param {string|undefined} [path]
 * @return {Object}
 */
const dateQueryBuilder = function ({date, type, path}) {
    // noinspection RegExpSingleCharAlternation
    // eslint-disable-next-line security/detect-unsafe-regex
    const regex = /^(\D{2})?(\d{4})(-\d{2})?(-\d{2})?(?:(T\d{2}:\d{2})(:\d{2})?)?(Z|(\+|-)(\d{2}):(\d{2}))?$/;
    const match = date.match(regex);
    let str = '';
    let toReturn = [];
    const pArr = []; //will have other possibilities such as just year, just year and month, etc
    let prefix = '$eq';
    if (match && match.length >= 1) {
        if (match[1]) {
            // replace prefix with mongo specific comparators
            prefix = '$' + match[1].replace('ge', 'gte').replace('le', 'lte');
        }

        if (type === 'date' || type === 'dateTime' || type === 'instant' || type === 'period' || type === 'timing') {
            //now we have to worry about hours, minutes, seconds, and TIMEZONES
            if (prefix === '$eq') {
                if (match[5]) {
                    //to see if time is included
                    for (let i = 2; i < 6; i++) {
                        str = str + match[`${i}`];
                        if (i === 5) {
                            pArr[i - 2] = str + 'Z?$';
                        } else {
                            pArr[i - 2] = str + '$';
                        }
                    }
                    if (type === 'instant') {
                        if (match[6]) {
                            //to check if seconds were included or not
                            str = str + match[6];
                        }
                    }
                    if (match[9]) {
                        // we know there is a +|-hh:mm at the end
                        let mins;
                        let hrs;
                        if (match[8] === '+') {
                            //time is ahead of UTC so we must subtract
                            const hM = match[5].split(':');
                            hM[0] = hM[0].replace('T', '');
                            mins = Number(hM[1]) - Number(match[10]);
                            hrs = Number(hM[0]) - Number(match[9]);
                            if (mins < 0) {
                                //when we subtract the minutes and go below zero, we need to remove an hour
                                mins = mod(mins, 60);
                                hrs = hrs - 1;
                            }
                            if (hrs < 0) {
                                //when hours goes below zero, we have to adjust the date
                                hrs = mod(hrs, 24);
                                str = getDateFromNum(
                                    getDayNum(
                                        Number(match[2]),
                                        Number(match[3].replace('-', '')),
                                        Number(match[4].replace('-', ''))
                                    ) - 1
                                );
                            } else {
                                str = getDateFromNum(
                                    getDayNum(
                                        Number(match[2]),
                                        Number(match[3].replace('-', '')),
                                        Number(match[4].replace('-', ''))
                                    )
                                );
                            }
                        } else {
                            //time is behind UTC so we add
                            const hM = match[5].split(':');
                            hM[0] = hM[0].replace('T', '');
                            mins = Number(hM[1]) + Number(match[10]);
                            hrs = Number(hM[0]) + Number(match[9]);
                            if (mins > 59) {
                                //if we go above 59, we need to increase hours
                                mins = mod(mins, 60);
                                hrs = hrs + 1;
                            }
                            if (hrs > 23) {
                                //if we go above 23 hours, new day
                                hrs = mod(hrs, 24);
                                str = getDateFromNum(
                                    getDayNum(
                                        Number(match[2]),
                                        Number(match[3].replace('-', '')),
                                        Number(match[4].replace('-', ''))
                                    ) + 1
                                );
                            } else {
                                str = getDateFromNum(
                                    getDayNum(
                                        Number(match[2]),
                                        Number(match[3].replace('-', '')),
                                        Number(match[4].replace('-', ''))
                                    )
                                );
                            }
                        }
                        pArr[5] = str + '$';
                        str = str + 'T' + ('0' + hrs).slice(-2) + ':' + ('0' + mins).slice(-2); //proper formatting for leading 0's
                        // eslint-disable-next-line security/detect-unsafe-regex
                        const match2 = str.match(/^(\d{4})(-\d{2})?(-\d{2})(?:(T\d{2}:\d{2})(:\d{2})?)?/);
                        if (match2 && match2.length >= 1) {
                            pArr[0] = match2[1] + '$'; //YYYY
                            pArr[1] = match2[1] + match2[2] + '$'; //YYYY-MM
                            pArr[2] = match2[1] + match2[2] + match2[3] + '$'; //YYYY-MM-DD
                            pArr[3] =
                                match2[1] +
                                match2[2] +
                                match2[3] +
                                'T' +
                                ('0' + hrs).slice(-2) +
                                ':' +
                                ('0' + mins).slice(-2) +
                                'Z?$';
                        }
                        if (match[6]) {
                            //to check if seconds were included or not
                            pArr[4] = str + ':' + ('0' + match[6]).slice(-2) + 'Z?$';
                            str = str + match[6];
                        }
                        if (!pArr[4]) {
                            //fill empty spots in pArr with ^$ to make sure it can't just match with nothing
                            pArr[4] = '^$';
                        }
                    }
                } else {
                    for (let i = 2; i < 5; i++) {
                        //add up the date parts in a string, done to make sure to update anything if timezone changed anything
                        if (match[`${i}`]) {
                            str = str + match[`${i}`];
                            pArr[i - 2] = str + '$';
                        }
                    }
                }
                const regexPattern = '^' +
                    '(?:' +
                    pArr[0] +
                    ')|(?:' +
                    pArr[1] +
                    ')|(?:' +
                    pArr[2] +
                    ')|(?:' +
                    pArr[3] +
                    ')|(?:' +
                    pArr[4] +
                    ')';
                const regPoss = {
                    // eslint-disable-next-line security/detect-non-literal-regexp
                    $regex: new RegExp(escapeRegExp(regexPattern)),
                };
                if (type === 'period') {
                    str = str + 'Z';
                    const pS = path + '.start';
                    const pE = path + '.end';
                    toReturn = [
                        {
                            $and: [
                                {[pS]: {$lte: str}},
                                {$or: [{[pE]: {$gte: str}}, {[pE]: regPoss}]},
                            ],
                        },
                        {$and: [{[pS]: {$lte: str}}, {[pE]: undefined}]},
                        {$and: [{$or: [{[pE]: {$gte: str}}, {[pE]: regPoss}]}, {[pS]: undefined}]},
                    ];
                    return toReturn;
                }
                const tempFill = pArr.toString().replace(/,/g, ')|(?:') + ')'; //turning the pArr to a string that can be used as a regex
                if (type === 'timing') {
                    const pDT = path + '.event';
                    const pBPS = path + '.repeat.boundsPeriod.start';
                    const pBPE = path + '.repeat.boundsPeriod.end';
                    toReturn = [
                        {
                            [pDT]: {
                                // eslint-disable-next-line security/detect-non-literal-regexp
                                $regex: new RegExp(
                                    escapeRegExp(
                                        '^' + '(?:' + str + ')|(?:' + match[0].replace('+', '\\+') + ')|(?:' + tempFill)
                                ), '$options': 'i',
                            },
                        },
                        {
                            $and: [
                                {[pBPS]: {$lte: str}},
                                {$or: [{[pBPE]: {$gte: str}}, {[pBPE]: regPoss}]},
                            ],
                        },
                        {$and: [{[pBPS]: {$lte: str}}, {[pBPE]: undefined}]},
                        {
                            $and: [
                                {$or: [{[pBPE]: {$gte: str}}, {[pBPE]: regPoss}]},
                                {[pBPS]: undefined},
                            ],
                        },
                    ];
                    return toReturn;
                }
                return {
                    // eslint-disable-next-line security/detect-non-literal-regexp
                    $regex: new RegExp(
                        escapeRegExp(
                            '^' + '(?:' + str + ')|(?:' + match[0].replace('+', '\\+') + ')|(?:' + tempFill)
                    ), '$options': 'i'
                };
            } else {
                for (let i = 2; i < 10; i++) {
                    if (match[`${i}`]) {
                        str = str + match[`${i}`];
                    }
                }
                const moment_dt = moment.utc(str);
                // convert to format that mongo uses to store
                const datetime_utc = moment_dt.utc().format('YYYY-MM-DDTHH:mm:ssZ');
                return {
                    [prefix]: datetime_utc
                };
            }
        }
    }
};


/**
 * Searches for date using the Date type
 * @param {string} dateSearchParameter
 * @param {string} type
 * @param {string|undefined} [path]
 * @return {Object}
 */
// noinspection JSUnusedLocalSymbols
// eslint-disable-next-line no-unused-vars
const dateQueryBuilderNative = function ({dateSearchParameter, type, path}) {
    const regex = /([a-z]+)(.+)/;
    const matches = dateSearchParameter.match(regex);
    const operation = matches[1];
    const date = moment.utc(matches[2]).toDate();
    const query = {};
    // from http://hl7.org/fhir/r4/search.html#date
    switch (operation) {
        case 'eq':
            query['$gte'] = moment(date).utc().startOf('day').toDate();
            query['$lte'] = moment(date).utc().endOf('day').toDate();
            break;
        case 'ne':
            query['$lt'] = moment(date).utc().startOf('day').toDate();
            query['$gt'] = moment(date).utc().endOf('day').toDate();
            break;
        case 'lt':
            query['$lt'] = date;
            break;
        case 'gt':
            query['$gt'] = date;
            break;
        case 'ge':
            query['$gte'] = date;
            break;
        case 'le':
            query['$lte'] = date;
            break;
        case 'sa':
            query['$lte'] = date;
            break;
        case 'eb':
            query['$lte'] = date;
            break;
        case 'ap':
            query['$lte'] = date;
            break;
        default:
            throw new Error(`${operation} is not supported.`);
    }
    return query;
};

/**
 * filters by date for a Period
 * https://www.hl7.org/fhir/search.html#date
 * https://www.hl7.org/fhir/search.html#prefix
 * @param {string} dateQueryItem
 * @param {string} fieldName
 * @returns {Object[]}
 */
const datetimePeriodQueryBuilder = function ({dateQueryItem, fieldName}) {
    // eslint-disable-next-line security/detect-unsafe-regex
    const regex = /([a-z]+)(.+)/;
    const match = dateQueryItem.match(regex);

    const [prefix, date] = (match && match.length >= 1 && match[1]) ?
        [match[1], dateQueryItem.slice(match[1].length)] :
        ['eq', dateQueryItem];

    // Build query for period.start
    let startQuery = {};
    switch (prefix) {
        case 'eq':
        case 'le':
        case 'lt':
            startQuery = dateQueryBuilder({
                date: `le${date}`,
                type: 'date'
            });
            break;
        case 'sa':
            startQuery = dateQueryBuilder({
                date: `ge${date}`,
                type: 'date'
            });
            break;
        case 'ge':
        case 'gt':
        case 'eb':
            startQuery = {
                $ne: null
            };
            break;
    }
    startQuery = {[`${fieldName}.start`]: startQuery};

    // Build query for period.end
    let endQuery = {};
    switch (prefix) {
        case 'eq':
        case 'ge':
        case 'gt':
            endQuery = {
                $or: [
                    {
                        [`${fieldName}.end`]: dateQueryBuilder({
                            date: `ge${date}`,
                            type: 'date'
                        })
                    },
                    {
                        [`${fieldName}.end`]: null
                    }
                ]
            };
            break;
        case 'eb':
            endQuery = {
                [`${fieldName}.end`]: dateQueryBuilder({
                    date: `le${date}`,
                    type: 'date'
                })
            };
            break;
    }

    return [startQuery, endQuery];
};

/**
 * @name compositeQueryBuilder
 * @description from looking at where composites are used, the fields seem to be implicit
 * @param {string} target What we're querying for
 * @param {string} field1 contains the path and search type
 * @param {string} field2 contains the path and search type
 */
const compositeQueryBuilder = function ({target, field1, field2}) {
    const composite = [];
    let temp = {};
    const [target1, target2] = target.split(/[$,]/);
    const [path1, type1] = field1.split('|');
    const [path2, type2] = field2.split('|');

    // Call the right queryBuilder based on type
    switch (type1) {
        case 'string':
            temp = {};
            temp[`${path1}`] = stringQueryBuilder({target: target1});
            composite.push(temp);
            break;
        case 'token':
            composite.push({
                $or: [
                    {$and: [tokenQueryBuilder({target: target1, type: 'code', field: path1})]},
                    {$and: [tokenQueryBuilder({target: target1, type: 'value', field: path1})]},
                ],
            });
            break;
        case 'reference':
            composite.push(referenceQueryBuilder({
                target_type: target,
                target: target1,
                field: path1,
            }));
            break;
        case 'quantity':
            composite.push(quantityQueryBuilder({target: target1, field: path1}));
            break;
        case 'number':
            temp = {};
            temp[`${path1}`] = numberQueryBuilder({target: target1});
            composite.push(temp);
            break;
        case 'date':
            composite.push({
                $or: [
                    {
                        [path1]: dateQueryBuilder({
                            date: target1, type: 'date'
                        })
                    },
                    {
                        [path1]: dateQueryBuilder({
                            date: target1, type: 'dateTime'
                        })
                    },
                    {
                        [path1]: dateQueryBuilder({
                            date: target1, type: 'instant'
                        })
                    },
                    {
                        $or: dateQueryBuilder({
                            date: target1, type: 'period', path: path1
                        })
                    },
                    {
                        $or: dateQueryBuilder({
                            date: target1, type: 'timing', path: path1
                        })
                    },
                ],
            });
            break;
        default:
            temp = {};
            temp[`${path1}`] = target1;
            composite.push(temp);
    }
    switch (type2) {
        case 'string':
            temp = {};
            temp[`${path2}`] = stringQueryBuilder({target: target2});
            composite.push(temp);
            break;
        case 'token':
            composite.push({
                $or: [
                    {$and: [tokenQueryBuilder({target: target2, type: 'code', field: path2})]},
                    {$and: [tokenQueryBuilder({target: target2, type: 'value', field: path2})]},
                ],
            });
            break;
        case 'reference':
            composite.push(referenceQueryBuilder({
                target_type: target,
                target: target2,
                field: path2
            }));
            break;
        case 'quantity':
            composite.push(quantityQueryBuilder({target: target2, field: path2}));
            break;
        case 'number':
            temp = {};
            temp[`${path2}`] = composite.push(numberQueryBuilder({target: target2}));
            composite.push(temp);
            break;
        case 'date':
            composite.push({
                $or: [
                    {
                        [path2]: dateQueryBuilder({
                            date: target2, type: 'date'
                        })
                    },
                    {
                        [path2]: dateQueryBuilder({
                            date: target2, type: 'dateTime'
                        })
                    },
                    {
                        [path2]: dateQueryBuilder({
                            date: target2, type: 'instant'
                        })
                    },
                    {
                        $or: dateQueryBuilder({
                            date: target2, type: 'period', path: path2
                        })
                    },
                    {
                        $or: dateQueryBuilder({
                            date: target2, type: 'timing', path: path2
                        })
                    },
                ],
            });
            break;
        default:
            temp = {};
            temp[`${path2}`] = target2;
            composite.push(temp);
    }

    if (target.includes('$')) {
        return {$and: composite};
    } else {
        return {$or: composite};
    }
};


/**
 * @name partialTextQueryBuilder
 * @param {string} field
 * @param {string} partialText
 * @param {boolean} ignoreCase
 * @return {JSON} queryBuilder
 */
const partialTextQueryBuilder = function ({field, partialText, ignoreCase}) {
    const queryBuilder = {};
    /**
     * @type {RegExp}
     */
        // eslint-disable-next-line security/detect-non-literal-regexp
    const regexObject = new RegExp(escapeRegExp(`${partialText}`));
    if (ignoreCase) {
        queryBuilder[`${field}`] = {$regex: regexObject, '$options': 'i'};
    } else {
        queryBuilder[`${field}`] = {$regex: regexObject};
    }

    return queryBuilder;
};


/**
 * @todo build out all prefix functionality for number and quantity and add date queries
 */
module.exports = {
    stringQueryBuilder,
    tokenQueryBuilder,
    referenceQueryBuilder,
    referenceQueryBuilderOptimized,
    addressQueryBuilder,
    nameQueryBuilder,
    numberQueryBuilder,
    quantityQueryBuilder,
    compositeQueryBuilder,
    dateQueryBuilder,
    dateQueryBuilderNative,
    datetimePeriodQueryBuilder,
    partialTextQueryBuilder,
    exactMatchQueryBuilder
};
