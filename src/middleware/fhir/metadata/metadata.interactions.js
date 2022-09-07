/**
 * Generate a list of interactions a particular profile can support
 * keep a local copy of interactions so this does not need to happen each time
 */
let profileInteractions = {};

let generateInteractions = (resourceType) => {
    // return from cache if it exists
    if (profileInteractions[`${resourceType}`]) {
        return profileInteractions[`${resourceType}`];
    }

    let interactions = []; // Test for the existence of a service method

    interactions.push({
        code: 'search-type'
    });

    interactions.push({
        code: 'read'
    });

    interactions.push({
        code: 'vread'
    });

    interactions.push({
        code: 'create'
    });

    interactions.push({
        code: 'update'
    });

    interactions.push({
        code: 'delete'
    });

    interactions.push({
        code: 'history-type'
    });

    interactions.push({
        code: 'history-instance'
    });

    interactions.push({
        code: 'expand'
    });

    // Save these interactions so we don't need to do this again
    profileInteractions[`${resourceType}`] = interactions;
    return interactions;
};

module.exports = generateInteractions;
