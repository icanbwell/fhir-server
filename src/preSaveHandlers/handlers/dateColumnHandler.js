const { PreSaveHandler } = require('./preSaveHandler');
const { isColumnDateType } = require('../../operations/common/isColumnDateType');

/**
 * @classdesc Converts date field from string to Date()
 */
class DateColumnHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    // if a column is of date type then set it to date (if not already)
    async preSaveAsync ({ resource }) {
        await this.processResource(resource, '');
        return resource;
    }

    async processResource (resource, path) {
        const extendPath = (existingPath, key) => {
            return existingPath ? `${existingPath}.${key}` : key;
        };

        const recurseData = (object, parentPath) => {
            Object.keys(object).forEach(key => {
                const currentPath = extendPath(parentPath, key);
                const value = object[key];
                if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                    if (typeof item === 'object' && item !== null) {
                        recurseData(item, extendPath(currentPath, index));
                    } else {
                        if (this.shouldUpdate(resource, extendPath(currentPath, index))) {
                            object[key][index] = this.setDate(item);
                        }
                    }
                });
                } else if (typeof value === 'object' && value !== null) {
                    recurseData(value, currentPath);
                } else {
                    if (value && this.shouldUpdate(resource, currentPath)) {
                        object[key] = this.setDate(value);
                    }
                }
            });
        };

        recurseData(resource, path);
    }

    shouldUpdate (resource, path) {
        const cleanPath = path.replace(/\.\d+(\.|$)/g, '.');
        return isColumnDateType(resource.resourceType, cleanPath);
    }

    setDate (scalar) {
        const newDate = new Date(scalar);
        if (isNaN(newDate.getTime())) {
            // return input if not valid date
            return scalar;
        } else {
            return newDate;
        }
    }
}

module.exports = {
    DateColumnHandler
};
