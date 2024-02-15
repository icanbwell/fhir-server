const parametersR4 = require('../resources/4_0_0/parameters');

// eslint-disable-next-line no-unused-vars
const getParameters = (version, resource) => {
    switch (version) {
        case '4_0_0':
            return parametersR4[`${resource}`];
    }
};
/**
 * @function getSearchParameters
 * @description Get the search parameters for a given resource on a specific version
 * @param {String} profile - Name of the profile we are retrieving arguments for
 * @param {String} version - Which version we are using
 * @param {String} [customArgsModule] - Path to a metadata module that contains
 *  a makeResource function that returns a search param
 * @return {Object} Arguments specific to a resource
 */
const getSearchParameters = (profile, version, customArgsModule) => {
    const lowercaseProfileName = profile.toLowerCase();
    let allArguments = {}; // If we have a custom args module, we will use this to populate the allowed
    // args for this particular route instead of the default arguments included

    if (customArgsModule) {
        const paramsAsArray = require(String(customArgsModule)).makeResource(Object.assign({}, {
            base_version: version,
            key: lowercaseProfileName
        })).searchParam; // We need to key these by name so we can remove duplicates on assign

        allArguments = paramsAsArray.reduce((all, arg) => {
            all[arg.name] = arg;
            return all;
        }, {});
    } else {
        allArguments = getParameters(version, lowercaseProfileName);
    } // Load our common arguments that apply to all resources

    allArguments = Object.assign(allArguments, getParameters(version, 'resource')); // Everyone has a DomainResource and Resource parameter we want to include
    // except DSTU2(1_0_2), so do not attempt to assign that in DSTU2

    if (version !== '1_0_2') {
        allArguments = Object.assign(allArguments, getParameters(version, 'domainresource'));
    } // Convert these into an array

    return Object.getOwnPropertyNames(allArguments).map(name => {
        return Object.assign({
            versions: version,
            name
        }, allArguments[`${name}`]);
    });
};

module.exports = {
    getSearchParameters,
    getParameters
};
