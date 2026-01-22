const deepcopy = require('deepcopy');

/**
 * filters resources to be fetched based on the list provided
 * @param {Object} resourceEverythingGraph
 * @param {Array} resourceFilterList
 * @return {Object}
 */
function filterResources(resourceEverythingGraph, resourceFilterList) {
    let result = deepcopy(resourceEverythingGraph);
    result['link'] = [];

    resourceEverythingGraph.link.forEach((link) => {
        let linksList = [];
        link.target.forEach((target) => {
            let targetCopy = target;
            if (Object.hasOwn(target, 'link')) {
                targetCopy = filterResources(target, resourceFilterList);
            }
            if (targetCopy['link'] || resourceFilterList.includes(targetCopy['type'])) {
                linksList.push(targetCopy);
            }
        });
        if (linksList.length > 0) {
            link.target = linksList;
            result['link'] = result['link'].concat(link);
        }
    });
    if (result['link'].length === 0) {
        delete result['link'];
    }
    return result;
}

module.exports = {
    filterResources
};
