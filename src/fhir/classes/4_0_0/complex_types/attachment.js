

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Attachment
    For referring to data content defined in other formats.
    If the element is present, it must have a value for at least one of the
    defined elements, an @id referenced from the Narrative, or extensions
*/
class Attachment extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {code|undefined} [contentType],
     * @param {code|undefined} [language],
     * @param {base64Binary|undefined} [data],
     * @param {url|undefined} [url],
     * @param {unsignedInt|undefined} [size],
     * @param {base64Binary|undefined} [hash],
     * @param {String|undefined} [title],
     * @param {dateTime|undefined} [creation],
     * @param {string|undefined} [_file_id]
    */
    constructor (
        {
            id,
            extension,
            contentType,
            language,
            data,
            url,
            size,
            hash,
            title,
            creation,
            _file_id
        }
    ) {
        super({});

        // ---- Define getters and setters as enumerable ---

        /**
         * @description None
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'id', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.id,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.id = undefined;
                    return;
                }
                this.__data.id = valueProvided;
            }
        });

        /**
         * @description May be used to represent additional information that is not part of the basic
    definition of the element. To make the use of extensions safe and manageable,
    there is a strict set of governance  applied to the definition and use of
    extensions. Though any implementer can define an extension, there is a set of
    requirements that SHALL be met as part of the definition of the extension.
         * @property {Extension[]|undefined}
        */
        Object.defineProperty(this, 'extension', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.extension,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.extension = undefined;
                    return;
                }
                const Extension = require('../complex_types/extension.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.extension = FhirResourceCreator.createArray(valueProvided, Extension);
            }
        });

        /**
         * @description Identifies the type of the data in the attachment and allows a method to be
    chosen to interpret or render the data. Includes mime type parameters such as
    charset where appropriate.
         * @property {code|undefined}
        */
        Object.defineProperty(this, 'contentType', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.contentType,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.contentType = undefined;
                    return;
                }
                this.__data.contentType = valueProvided;
            }
        });

        /**
         * @description The human language of the content. The value can be any valid value according
    to BCP 47.
         * @property {code|undefined}
        */
        Object.defineProperty(this, 'language', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.language,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.language = undefined;
                    return;
                }
                this.__data.language = valueProvided;
            }
        });

        /**
         * @description The actual data of the attachment - a sequence of bytes, base64 encoded.
         * @property {base64Binary|undefined}
        */
        Object.defineProperty(this, 'data', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.data,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.data = undefined;
                    return;
                }
                this.__data.data = valueProvided;
            }
        });

        /**
         * @description A location where the data can be accessed.
         * @property {url|undefined}
        */
        Object.defineProperty(this, 'url', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.url,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.url = undefined;
                    return;
                }
                this.__data.url = valueProvided;
            }
        });

        /**
         * @description The number of bytes of data that make up this attachment (before base64
    encoding, if that is done).
         * @property {unsignedInt|undefined}
        */
        Object.defineProperty(this, 'size', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.size,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.size = undefined;
                    return;
                }
                this.__data.size = valueProvided;
            }
        });

        /**
         * @description The calculated hash of the data using SHA-1. Represented using base64.
         * @property {base64Binary|undefined}
        */
        Object.defineProperty(this, 'hash', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.hash,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.hash = undefined;
                    return;
                }
                this.__data.hash = valueProvided;
            }
        });

        /**
         * @description A label or set of text to display in place of the data.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'title', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.title,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.title = undefined;
                    return;
                }
                this.__data.title = valueProvided;
            }
        });

        /**
         * @description The date that the attachment was first created.
         * @property {dateTime|undefined}
        */
        Object.defineProperty(this, 'creation', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.creation,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.creation = undefined;
                    return;
                }
                this.__data.creation = valueProvided;
            }
        });

        /**
         * @description _file_id
         * @property {string|undefined}
         */
        Object.defineProperty(this, '_file_id', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._file_id,
            set: valueProvided => {
                this.__data._file_id = valueProvided;
            }
        });

        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            contentType,
            language,
            data,
            url,
            size,
            hash,
            title,
            creation,
            _file_id
        });
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON () {
        return removeNull({
            id: this.id,
            extension: this.extension && this.extension.map(v => v.toJSON()),
            contentType: this.contentType,
            language: this.language,
            data: this.data,
            url: this.url,
            size: this.size,
            hash: this.hash,
            title: this.title,
            creation: this.creation
        });
    }

    /**
     * Returns JSON representation of entity
     * @param {function(Reference): Promise<Reference>} fnUpdateReferenceAsync
     * @return {void}
     */
    async updateReferencesAsync ({ fnUpdateReferenceAsync }) {
            if (this.extension) { await async.each(this.extension, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSONInternal () {
        const json = {
            id: this.id,
            extension: this.extension && this.extension.map(v => v.toJSONInternal()),
            contentType: this.contentType,
            language: this.language,
            data: this.data,
            url: this.url,
            size: this.size,
            hash: this.hash,
            title: this.title,
            creation: this.creation
        };
        if (this._file_id) {
            json._file_id = this._file_id;
        }

        return removeNull(json);
    }
}

module.exports = Attachment;
