

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Device.UdiCarrier
    A type of a manufactured item that is used in the provision of healthcare
    without being substantially changed through that activity. The device may be a
    medical or non-medical device.
*/
class DeviceUdiCarrier extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {String|undefined} [deviceIdentifier],
     * @param {uri|undefined} [issuer],
     * @param {uri|undefined} [jurisdiction],
     * @param {base64Binary|undefined} [carrierAIDC],
     * @param {String|undefined} [carrierHRF],
     * @param {code|undefined} [entryType],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            deviceIdentifier,
            issuer,
            jurisdiction,
            carrierAIDC,
            carrierHRF,
            entryType
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
         * @description May be used to represent additional information that is not part of the basic
    definition of the element and that modifies the understanding of the element
    in which it is contained and/or the understanding of the containing element's
    descendants. Usually modifier elements provide negation or qualification. To
    make the use of extensions safe and manageable, there is a strict set of
    governance applied to the definition and use of extensions. Though any
    implementer can define an extension, there is a set of requirements that SHALL
    be met as part of the definition of the extension. Applications processing a
    resource are required to check for modifier extensions.

    Modifier extensions SHALL NOT change the meaning of any elements on Resource
    or DomainResource (including cannot change the meaning of modifierExtension
    itself).
         * @property {Extension[]|undefined}
        */
        Object.defineProperty(this, 'modifierExtension', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.modifierExtension,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.modifierExtension = undefined;
                    return;
                }
                const Extension = require('../complex_types/extension.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.modifierExtension = FhirResourceCreator.createArray(valueProvided, Extension);
            }
        });

        /**
         * @description The device identifier (DI) is a mandatory, fixed portion of a UDI that
    identifies the labeler and the specific version or model of a device.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'deviceIdentifier', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.deviceIdentifier,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.deviceIdentifier = undefined;
                    return;
                }
                this.__data.deviceIdentifier = valueProvided;
            }
        });

        /**
         * @description Organization that is charged with issuing UDIs for devices.  For example, the
    US FDA issuers include :
    1) GS1:
    http://hl7.org/fhir/NamingSystem/gs1-di,
    2) HIBCC:
    http://hl7.org/fhir/NamingSystem/hibcc-dI,
    3) ICCBBA for blood containers:
    http://hl7.org/fhir/NamingSystem/iccbba-blood-di,
    4) ICCBA for other devices:
    http://hl7.org/fhir/NamingSystem/iccbba-other-di.
         * @property {uri|undefined}
        */
        Object.defineProperty(this, 'issuer', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.issuer,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.issuer = undefined;
                    return;
                }
                this.__data.issuer = valueProvided;
            }
        });

        /**
         * @description The identity of the authoritative source for UDI generation within a
    jurisdiction.  All UDIs are globally unique within a single namespace with the
    appropriate repository uri as the system.  For example,  UDIs of devices
    managed in the U.S. by the FDA, the value is
    http://hl7.org/fhir/NamingSystem/fda-udi.
         * @property {uri|undefined}
        */
        Object.defineProperty(this, 'jurisdiction', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.jurisdiction,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.jurisdiction = undefined;
                    return;
                }
                this.__data.jurisdiction = valueProvided;
            }
        });

        /**
         * @description The full UDI carrier of the Automatic Identification and Data Capture (AIDC)
    technology representation of the barcode string as printed on the packaging of
    the device - e.g., a barcode or RFID.   Because of limitations on character
    sets in XML and the need to round-trip JSON data through XML, AIDC Formats
    *SHALL* be base64 encoded.
         * @property {base64Binary|undefined}
        */
        Object.defineProperty(this, 'carrierAIDC', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.carrierAIDC,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.carrierAIDC = undefined;
                    return;
                }
                this.__data.carrierAIDC = valueProvided;
            }
        });

        /**
         * @description The full UDI carrier as the human readable form (HRF) representation of the
    barcode string as printed on the packaging of the device.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'carrierHRF', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.carrierHRF,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.carrierHRF = undefined;
                    return;
                }
                this.__data.carrierHRF = valueProvided;
            }
        });

        /**
         * @description A coded entry to indicate how the data was entered.
         * @property {code|undefined}
        */
        Object.defineProperty(this, 'entryType', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.entryType,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.entryType = undefined;
                    return;
                }
                this.__data.entryType = valueProvided;
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            deviceIdentifier,
            issuer,
            jurisdiction,
            carrierAIDC,
            carrierHRF,
            entryType
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
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSON()),
            deviceIdentifier: this.deviceIdentifier,
            issuer: this.issuer,
            jurisdiction: this.jurisdiction,
            carrierAIDC: this.carrierAIDC,
            carrierHRF: this.carrierHRF,
            entryType: this.entryType
        });
    }

    /**
     * Returns JSON representation of entity
     * @param {function(Reference): Promise<Reference>} fnUpdateReferenceAsync
     * @return {void}
     */
    async updateReferencesAsync ({ fnUpdateReferenceAsync }) {
            if (this.extension) { await async.each(this.extension, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.modifierExtension) { await async.each(this.modifierExtension, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSONInternal () {
        const json = {
            id: this.id,
            extension: this.extension && this.extension.map(v => v.toJSONInternal()),
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSONInternal()),
            deviceIdentifier: this.deviceIdentifier,
            issuer: this.issuer,
            jurisdiction: this.jurisdiction,
            carrierAIDC: this.carrierAIDC,
            carrierHRF: this.carrierHRF,
            entryType: this.entryType
        };

        return removeNull(json);
    }
}

module.exports = DeviceUdiCarrier;
