const {PreSaveHandler} = require('./preSaveHandler');
const {isColumnDateType} = require('../../operations/common/isColumnDateType');

/**
 * @classdesc Converts date field from string to Date()
 */
class DateColumnHandler extends PreSaveHandler {
    // if a column is of date type then set it to date (if not already)
    async preSaveAsync({resource}) {
        for (const [fieldName, field] of Object.entries(resource)) {
            if (typeof field === 'object' && !Array.isArray(field)) {
                await this.processObject(resource, field, fieldName, '');
            } else if (Array.isArray(field)) {
                await this.processArray(resource, field, fieldName, '');
            } else {
                if (isColumnDateType(resource.resourceType, fieldName)) {
                    if (!(resource[`${fieldName}`] instanceof Date)) {
                        resource[`${fieldName}`] = new Date(field);
                    }
                }
            }
        }
        return resource;
    }

    async processObject(resource, field, fieldName, namePath) {
        if (typeof field === 'object' && !Array.isArray(field)) {
            for (const [subFieldName, subField] of Object.entries(field)) {
                await this.processObject(resource, subField, subFieldName, `${namePath}.${fieldName}`);
            }
        } else if (Array.isArray(field)) {
            await this.processArray(resource, field, fieldName, `${namePath}.${fieldName}`);
        } else {
            let path = fieldName;
            if (namePath.length > 0) {
                path = `${namePath}.${fieldName}`;
            }
            if (isColumnDateType(resource.resourceType, path)) {
                if (!(resource[`${path}`] instanceof Date)) {
                    resource[`${path}`] = new Date(field);
                }
            }
        }
    }

    async processArray(resource, field, fieldName, namePath) {
        for (let i = 0; i < field.length(); i++) {
            if (typeof field[i] === 'object' && !Array.isArray(field[i])) {
                for (const [subFieldName, subField] of Object.entries(field[i])) {
                    await this.processObject(resource, subField, subFieldName, `${namePath}.${fieldName}`);
                }
            } else if (Array.isArray(field[i])) {
                await this.processArray(resource, field[i], fieldName, `${namePath}.${fieldName}`);
            } else {
                let path = fieldName;
                if (namePath.length > 0) {
                    path = `${namePath}.${fieldName}`;
                }
                if (isColumnDateType(resource.resourceType, path)) {
                    if (!(field[i] instanceof Date)) {
                        field[i] = new Date(field[i]);
                    }
                }
            }
        }
    }

}

module.exports = {
    DateColumnHandler
};
