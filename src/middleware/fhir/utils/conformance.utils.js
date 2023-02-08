const {
    getSearchParameters
} = require('./params.utils'); // /**

/**
 * @description Filter function for determining which searchParam fields are needed
 * for conformance/capability statements
 // * @param {Object} route_arg - route argument
 * @param {string} base_version - which version (not necessary now, but may be in the future)
 * @return {function} filter function for array.filter
 */
let conformanceSearchParamsFilter = base_version => route_arg => {
    return route_arg.conformance_hide ? // If the conformance_hide property is true, always remove this element
        false : // Else check our versions property, there are two possible cases
        // If no versions are provided, it is available for all versions
        !route_arg.versions || // If versions are provided, make sure this arg is meant for this version
        route_arg.versions && route_arg.versions.indexOf(base_version) > -1;
};
/**
 * @description Map function for taking a router argument and mapping it
 * into the searchParam field needed for conformance/capability statements
 * @param {string} version - which version (not necessary now, but may be in the future)
 * @return {function} map function for array.map
 */

/* eslint-disable no-unused-vars */


let conformanceSearchParamsMap = version => route_arg => {
    // The router adds extra arguments and those need to be discarded
    // these are the only fields we currently care about
    return {
        name: route_arg.name,
        type: route_arg.type,
        definition: route_arg.definition,
        documentation: route_arg.documentation || route_arg.description
    };
};


let getSearchParams = (profileKey, version) => {
    let params = getSearchParameters(profileKey, version).filter(conformanceSearchParamsFilter(version));

    for (let key of Object.keys(params)) {
        let param = params[`${key}`]; // don't show version

        if (param.versions) {
            delete param.versions;
        }
    }

    return params;
};

module.exports = {
    getSearchParams
};
