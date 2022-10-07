const {customIndexes} = require('./customIndexes');

class IndexProvider {
    getIndexes() {
        return customIndexes;
    }

    /**
     * whether there is an index for all the passed in access codes
     * @param string[] accessCodes
     * @returns {boolean}
     */
    hasIndexForAccessCodes({accessCodes}) {
        const accessCodesWithIndexes = ['medstar', 'Thedacare'];
        return accessCodes.every(ac => accessCodesWithIndexes.includes(ac));
    }
}

module.exports = {
    IndexProvider
};
