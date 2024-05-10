/**
 * Builds a mongo query for search parameters
 * @param {ParsedArgs} args
 * @returns {import('mongodb').Document}
 */
module.exports.buildStu3SearchQuery = (args) => {
    // Common search params
    const { id } = args;

    // Search Result params

    // Patient search params
    const active = args.active;

    const query = {};

    if (id) {
        query.id = id;
    }

    if (active) {
        query.active = active === 'true';
    }

    return query;
};
