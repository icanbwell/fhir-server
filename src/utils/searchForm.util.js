const identifierUrl = 'http://hl7.org/fhir/sid/us-npi|';
const advSearchJson = require('../fhir/generator/json/definitions.json/search-parameters.json');
const searchLimit = 100;
const searchLimitForIds = 10000;

/**
 * @typedef FieldInfo
 * @type {Object}
 * @property {string} label
 * @property {string} name
 * @property {string} [sortField]
 * @property {*} value
 * @property {boolean|undefined} [useExactMatch]
 */


function getSearchParams(req) {
    const bodyEntries = Object.entries(req.body);
    // eslint-disable-next-line no-unused-vars
    const nonEmptyOrNull = bodyEntries.filter(([, val]) => val !== '' && val !== null);
    return Object.fromEntries(nonEmptyOrNull);
}

function handleModifierKey(key) {
    const modifierIndex = key.indexOf(':');
    return modifierIndex > 0 ? key.substring(0, modifierIndex) : key;
}

function getModifierParams(req) {
    const searchParams = getSearchParams(req);
    return Object.assign(
        {},
        ...Object.keys(searchParams).map((key) => ({
            [handleModifierKey(key)]: searchParams[`${key}`],
        }))
    );
}

/**
 * @param params
 * @return {FieldInfo}
 */
function givenNameField(params) {
    return {
        label: 'Given (Name)',
        name: 'given',
        sortField: 'name',
        value: params.given ? params.given : '',
        useExactMatch: true
    };
}

/**
 * @param params
 * @return {FieldInfo}
 */
function familyNameField(params) {
    return {
        label: 'Family (Name)',
        name: 'family',
        sortField: 'name.family',
        value: params.family ? params.family : '',
        useExactMatch: true
    };
}

/**
 * @param params
 * @return {FieldInfo}
 */
function emailField(params) {
    return {
        label: 'Email',
        name: 'email',
        sortField: 'name',
        value: params.telecom ? params.telecom : '',
        useExactMatch: true
    };
}

/**
 * @param params
 * @return {FieldInfo}
 */
// eslint-disable-next-line no-unused-vars
function identifierField(params) {
    return {
        label: 'Identifier',
        name: 'identifier',
        sortField: 'identifier',
        value: '',
        useExactMatch: true
    };
}

/**
 * @param {Object} params
 * @param {string} tagName
 * @return {FieldInfo}
 */
// eslint-disable-next-line no-unused-vars
function securityTagField(params, tagName) {
    return {
        label: 'Security',
        name: '_security',
        sortField: '_security',
        value: '',
        useExactMatch: true
    };
}

/**
 * @param params
 * @return {FieldInfo[]}
 */
function getPatientForm(params) {
    /**
     * @type {FieldInfo[]}
     */
    let patientArray = [];
    patientArray.push(givenNameField(params));
    patientArray.push(familyNameField(params));
    patientArray.push(emailField(params));
    patientArray.push(securityTagField(params, 'owner'));
    return patientArray;
}

function getPersonForm(params) {
    /**
     * @type {FieldInfo[]}
     */
    let personArray = [];
    personArray.push({
        label: 'Name',
        name: 'name',
        sortField: 'name',
        value: params.name ? params.name : '',
        useExactMatch: true
    });
    personArray.push(emailField(params));
    personArray.push(securityTagField(params, 'owner'));
    return personArray;
}

/**
 * @param params
 * @return {FieldInfo[]}
 */
function getPractitionerForm(params) {
    /**
     * @type {FieldInfo[]}
     */
    const practitionerArray = [];
    practitionerArray.push(givenNameField(params));
    practitionerArray.push(familyNameField(params));
    practitionerArray.push({
        label: 'NPI',
        name: 'npi',
        sortField: 'identifier',
        value: params.identifier ? params.identifier.replace(identifierUrl, '') : '',
    });
    practitionerArray.push(securityTagField(params, 'owner'));
    return practitionerArray;
}

/**
 * @param params
 * @return {FieldInfo[]}
 */
function getOrganizationForm(params) {
    /**
     * @type {FieldInfo[]}
     */
    const formElements = [];
    formElements.push({
        label: 'Name',
        name: 'name',
        sortField: 'name',
        value: params.name ? params.name : '',
    });
    formElements.push(securityTagField(params, 'owner'));
    return formElements;
}

/**
 * @param params
 * @return {FieldInfo[]}
 */
function getEncounterForm(params) {
    /**
     * @type {FieldInfo[]}
     */
    const formElements = [];
    formElements.push({
        columnHeader: 'Period',
        label: 'Date',
        name: 'date',
        sortField: 'period',
        value: params.date ? params.date : '',
    });
    return formElements;
}

/**
 * @param req
 * @param {string} resourceName
 * @return {FieldInfo[]}
 */
const getFormData = (req, resourceName) => {
    const params = getModifierParams(req);
    /**
     * @type {FieldInfo[]}
     */
    let formData = [];

    switch (resourceName) {
        case 'Patient':
            formData = formData.concat(getPatientForm(params));
            break;
        case 'Person':
            formData = formData.concat(getPersonForm(params));
            break;
        case 'Practitioner':
            formData = formData.concat(getPractitionerForm(params));
            break;
        case 'Organization':
            formData = formData.concat(getOrganizationForm(params));
            break;
        case 'Encounter':
            formData = formData.concat(getEncounterForm(params));
            break;
    }

    formData.push({
        label: 'Id',
        name: 'id',
        sortField: 'id',
        value: params.id ? params.id : '',
        useExactMatch: true
    });

    formData.push(identifierField(params));

    formData.push({
        label: 'Source',
        name: '_source',
        sortField: 'meta.source',
        value: params._source ? params._source : '',
    });

    return formData;
};

/**
 *
 * @param req
 * @param resourceName
 * @return {FieldInfo[]}
 */
const getAdvSearchFormData = (req, resourceName) => {
    /**
     * @type {FieldInfo[]}
     */
    const basicFormData = getFormData(req, resourceName);
    const params = getModifierParams(req);
    /**
     * @type {FieldInfo[]}
     */
    let advFormData = [];
    const resourceFields = advSearchJson.entry.filter((entry) => {
        return entry.resource.base.includes(resourceName) && entry.resource.type === 'string';
    });

    resourceFields.forEach((advParam) => {
        const foundBasic = basicFormData.find(
            (formData) => formData.name === advParam.resource.name
        );
        if (foundBasic) {
            return;
        }
        advFormData.push({
            label: advParam.resource.name
                .split('-')
                .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
                .join(' '),
            name: advParam.resource.name,
            value: params[advParam.resource.name] ? params[advParam.resource.name] : '',
        });
    });
    return advFormData;
};

function getCurrentPageIndex(pageIndex) {
    pageIndex = pageIndex && pageIndex !== '' ? parseInt(pageIndex) : 0;
    return pageIndex;
}

const getHasPrev = (pageOffset) => {
    const pageIndex = getCurrentPageIndex(pageOffset);
    return pageIndex > 0;
};

const getHasNext = (res) => {
    return res.resources.length === searchLimit;
};

const getLastUpdate = function (req, index) {
    const searchParams = getSearchParams(req);
    return searchParams['_lastUpdated'] ? searchParams['_lastUpdated'].at(index) : '';
};

const zeroPad = (number) => {
    return number < 10 ? `0${number}` : `${number}`;
};

const formatDate = (dateString) => {
    if (dateString === '') {
        return '';
    }
    const dateObj = new Date(dateString);
    return `${dateObj.getFullYear()}-${zeroPad(dateObj.getMonth() + 1)}-${zeroPad(
        dateObj.getDate()
    )}
        ${zeroPad(dateObj.getHours())}:${zeroPad(dateObj.getMinutes())}
        `;
};

const givenNameValue = (nameObj) => {
    if (!nameObj) {
        return '';
    }
    const nameMap = nameObj.map((n) => {
        return n.given ? n.given[0] : '';
    });
    return nameMap.join(', ');
};

/**
 * Returns updates date range for a field
 * @param {string} name
 * @return {string}
 */
const getNameValue = (name) => {
    if (!name) {return '';}
    if (typeof name === 'object') {
        if (Array.isArray(name)) {
            return name.map(n => n.family).join(', ');
        }
        return name.family || JSON.stringify(name);
    }
    return name;
};

/**
 * Returns updates date range for a field
 * @param res
 * @param {string} name
 * @return {string}
 */
const getFieldValue = (res, name) => {
    switch (name) {
        case '_source':
            return res?.meta?.source || '';
        case 'npi':
            return (res.identifier || [])
                .map(id => id.value)
                .join(', ');
        case 'given':
            return givenNameValue(res.name);
        case 'family':
            return (res.name || [])
                .map(n => n.family)
                .join(', ');
        case 'name':
            return getNameValue(res.name);
        case 'id':
            return res.id || '';
        case 'email':
            return (res.telecom || [])
                .filter(n => n.system === 'email')
                .map(n => n.value)
                .join(', ');
        case 'identifier':
            return (res.identifier || [])
                .map(n => `${n.value}(${n.system})`)
                .join(', ');
        case '_security':
            return (res.meta && res.meta.security || [])
                .map(n => `${n.code}(${n.system.split('/').pop()})`)
                .join(', ');
    }
    if (res.name) {
        return res.name;
    }
    if (Array.isArray(res)) {
        return res.map(r => r.name).join(', ');
    }
    return JSON.stringify(res[`${name}`]);
};

const isValidResource = (resource, resourceName) => {
    if (!resource || !resourceName) {
        return false;
    }
    return resource.resourceType === resourceName;
};

const getTotalMessage = (res) => {
    if (
        res.resources.length === 0 ||
        !isValidResource(res.resources[0], res.resourceDefinition.name)
    ) {
        return '';
    }
    const pageIndex = getCurrentPageIndex(res.body._getpagesoffset);
    const lowCount = searchLimit * pageIndex + 1;
    const increaseCount = res.resources.length < searchLimit ? res.resources.length : searchLimit;
    const highCount = searchLimit * pageIndex + increaseCount;
    return `${lowCount} to ${highCount} of found results`;
};

const getSortIcon = (fieldName, sortField) => {
    if (fieldName === sortField) {
        return ' fa-sort-amount-asc';
    }
    if (`-${fieldName}` === sortField) {
        return ' fa-sort-amount-desc';
    }
    return '';
};

const utils = {
    hasPrev: getHasPrev,
    hasNext: getHasNext,
    formatDate: formatDate,
    fieldValue: getFieldValue,
    totalMessage: getTotalMessage,
    pageIndex: getCurrentPageIndex,
    validResource: isValidResource,
    sortIcon: getSortIcon,
};

module.exports = {
    advSearchFormData: getAdvSearchFormData,
    searchFormData: getFormData,
    lastUpdateStart: getLastUpdate,
    lastUpdateEnd: getLastUpdate,
    limit: searchLimit,
    searchLimitForIds: searchLimitForIds,
    searchUtils: utils,
};
