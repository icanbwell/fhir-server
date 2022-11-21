const {customIndexes} = require('./customIndexes');
const {assertTypeEquals} = require('../utils/assertType');
const {ConfigManager} = require('../utils/configManager');

class IndexProvider {
    /**
     * cosntructor
     * @param {ConfigManager} configManager
     */
    constructor({
                    configManager
                }) {

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    getIndexes() {
        return customIndexes;
    }

    /**
     * whether there is an index for all the passed in access codes
     * @param string[] accessCodes
     * @returns {boolean}
     */
    hasIndexForAccessCodes({accessCodes}) {
        const accessCodesWithIndexes = this.configManager.accessTagsIndexed || ['medstar', 'Thedacare'];
        return accessCodes.every(ac => accessCodesWithIndexes.includes(ac));
    }
}

module.exports = {
    IndexProvider
};
