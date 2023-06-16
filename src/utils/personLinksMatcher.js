const { isEqual } = require('lodash');

/**
 * @description Matches the two link array of person resources.
 * @param {Object[]} personResourceLink1
 * @param {Object[]} personResourceLink2
 * @returns {boolean}
 */
function matchPersonLinks(personResourceLink1, personResourceLink2) {
    const sortedLinkPersonResource1 = personResourceLink1.slice().sort((a, b) => a.target.reference.localeCompare(b.target.reference));
    const sortedLinkPersonResource2 = personResourceLink2.slice().sort((a, b) => a.target.reference.localeCompare(b.target.reference));
    return isEqual(sortedLinkPersonResource1, sortedLinkPersonResource2);
}

module.exports = {matchPersonLinks};
