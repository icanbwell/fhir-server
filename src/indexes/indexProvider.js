const fs = require('fs');
const { customIndexes } = require('./customIndexes');
const { assertTypeEquals } = require('../utils/assertType');
const { ConfigManager } = require('../utils/configManager');

class IndexProvider {
    /**
     * cosntructor
     * @param {ConfigManager} configManager
     */
    constructor ({
                    configManager
                }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this._customIndexesFilePath = configManager.customIndexesFilePath;
        if (this._customIndexesFilePath) {
            const fileContent = fs.readFileSync(this._customIndexesFilePath, 'utf-8');
            this._indexes = JSON.parse(fileContent);
            if (Object.prototype.hasOwnProperty.call(this._indexes, '*')) {
                throw new Error(
                    `Custom indexes file ${this._customIndexesFilePath} contains an unsupported "*" key. ` +
                    'Define indexes per resource collection (e.g. "Patient_4_0_0") instead. ' +
                    '"*_History" is still supported for history collections.'
                );
            }
            this._accessCodesMap = this._buildAccessCodesMap();
        } else {
            this._indexes = null;
            this._accessCodesMap = null;
        }
    }

    getIndexes () {
        if (this._indexes) {
            return this._indexes;
        }
        return customIndexes;
    }

    /**
     * whether there is an index for all the passed in access codes
     * @param string[] accessCodes
     * @returns {boolean}
     */
    hasIndexForAccessCodes ({ accessCodes, resourceType }) {
        if (this._accessCodesMap) {
            const resourceAccessCodes = this._accessCodesMap[resourceType] || [];
            return accessCodes.every(ac => resourceAccessCodes.includes(ac));
        }
        const accessCodesWithIndexes = this.configManager.accessTagsIndexed(resourceType);
        return accessCodes.every(ac => accessCodesWithIndexes.includes(ac));
    }

    _buildAccessCodesMap () {
        const indexes = this.getIndexes();
        const map = {};

        for (const [collectionName, resourceIndexes] of Object.entries(indexes)) {
            if (collectionName.endsWith('_History')) {
                continue;
            }
            const resourceType = collectionName.replace('_4_0_0', '');
            const codes = [];
            for (const index of resourceIndexes) {
                for (const key of Object.keys(index.keys || {})) {
                    if (key.startsWith('_access.')) {
                        codes.push(key.replace('_access.', ''));
                    }
                }
            }
            if (codes.length > 0) {
                map[resourceType] = [...new Set(codes)];
            }
        }
        return map;
    }
}

module.exports = {
    IndexProvider
};
