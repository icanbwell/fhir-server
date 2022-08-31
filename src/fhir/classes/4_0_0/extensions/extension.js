/**
 * @name exports
 * @summary Extension Class
 */
class Extension {
    constructor(opts) {
        // Create an object to store all props
        Object.defineProperty(this, '__data', {
            value: {},
        }); // Define getters and setters as enumerable

        Object.defineProperty(this, 'id', {
            enumerable: true,
            get: () => this.__data.id,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.id = value;
            },
        });
        Object.defineProperty(this, 'extension', {
            enumerable: true,
            get: () => this.__data.extension,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.extension = Array.isArray(value) ?
                    value.map((v) => new Extension(v)) : [new Extension(value)];
            },
        });
        Object.defineProperty(this, 'url', {
            enumerable: true,
            get: () => this.__data.url,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.url = value;
            },
        });
        Object.defineProperty(this, 'valueBase64Binary', {
            enumerable: true,
            get: () => this.__data.valueBase64Binary,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueBase64Binary = value;
            },
        });
        Object.defineProperty(this, 'valueBoolean', {
            enumerable: true,
            get: () => this.__data.valueBoolean,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueBoolean = value;
            },
        });
        Object.defineProperty(this, 'valueCanonical', {
            enumerable: true,
            get: () => this.__data.valueCanonical,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueCanonical = value;
            },
        });
        Object.defineProperty(this, 'valueCode', {
            enumerable: true,
            get: () => this.__data.valueCode,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueCode = value;
            },
        });
        Object.defineProperty(this, 'valueDate', {
            enumerable: true,
            get: () => this.__data.valueDate,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueDate = value;
            },
        });
        Object.defineProperty(this, 'valueDateTime', {
            enumerable: true,
            get: () => this.__data.valueDateTime,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueDateTime = value;
            },
        });
        Object.defineProperty(this, 'valueDecimal', {
            enumerable: true,
            get: () => this.__data.valueDecimal,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueDecimal = value;
            },
        });
        Object.defineProperty(this, 'valueId', {
            enumerable: true,
            get: () => this.__data.valueId,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueId = value;
            },
        });
        Object.defineProperty(this, 'valueInstant', {
            enumerable: true,
            get: () => this.__data.valueInstant,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueInstant = value;
            },
        });
        Object.defineProperty(this, 'valueInteger', {
            enumerable: true,
            get: () => this.__data.valueInteger,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueInteger = value;
            },
        });
        Object.defineProperty(this, 'valueMarkdown', {
            enumerable: true,
            get: () => this.__data.valueMarkdown,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueMarkdown = value;
            },
        });
        Object.defineProperty(this, 'valueOid', {
            enumerable: true,
            get: () => this.__data.valueOid,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueOid = value;
            },
        });
        Object.defineProperty(this, 'valuePositiveInt', {
            enumerable: true,
            get: () => this.__data.valuePositiveInt,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valuePositiveInt = value;
            },
        });
        Object.defineProperty(this, 'valueString', {
            enumerable: true,
            get: () => this.__data.valueString,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueString = value;
            },
        });
        Object.defineProperty(this, 'valueTime', {
            enumerable: true,
            get: () => this.__data.valueTime,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueTime = value;
            },
        });
        Object.defineProperty(this, 'valueUnsignedInt', {
            enumerable: true,
            get: () => this.__data.valueUnsignedInt,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueUnsignedInt = value;
            },
        });
        Object.defineProperty(this, 'valueUri', {
            enumerable: true,
            get: () => this.__data.valueUri,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueUri = value;
            },
        });
        Object.defineProperty(this, 'valueUrl', {
            enumerable: true,
            get: () => this.__data.valueUrl,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueUrl = value;
            },
        });
        Object.defineProperty(this, 'valueUuid', {
            enumerable: true,
            get: () => this.__data.valueUuid,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.valueUuid = value;
            },
        });
        Object.defineProperty(this, 'valueAddress', {
            enumerable: true,
            get: () => this.__data.valueAddress,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Address = require('../complex_types/address.js');

                this.__data.valueAddress = new Address(value);
            },
        });
        Object.defineProperty(this, 'valueAge', {
            enumerable: true,
            get: () => this.__data.valueAge,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Age = require('../complex_types/age.js');

                this.__data.valueAge = new Age(value);
            },
        });
        Object.defineProperty(this, 'valueAnnotation', {
            enumerable: true,
            get: () => this.__data.valueAnnotation,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Annotation = require('../complex_types/annotation.js');

                this.__data.valueAnnotation = new Annotation(value);
            },
        });
        Object.defineProperty(this, 'valueAttachment', {
            enumerable: true,
            get: () => this.__data.valueAttachment,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Attachment = require('../complex_types/attachment.js');

                this.__data.valueAttachment = new Attachment(value);
            },
        });
        Object.defineProperty(this, 'valueCodeableConcept', {
            enumerable: true,
            get: () => this.__data.valueCodeableConcept,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let CodeableConcept = require('../complex_types/codeableConcept.js');

                this.__data.valueCodeableConcept = new CodeableConcept(value);
            },
        });
        Object.defineProperty(this, 'valueCoding', {
            enumerable: true,
            get: () => this.__data.valueCoding,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Coding = require('../complex_types/coding');

                this.__data.valueCoding = new Coding(value);
            },
        });
        Object.defineProperty(this, 'valueContactPoint', {
            enumerable: true,
            get: () => this.__data.valueContactPoint,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let ContactPoint = require('../complex_types/contactPoint.js');

                this.__data.valueContactPoint = new ContactPoint(value);
            },
        });
        Object.defineProperty(this, 'valueCount', {
            enumerable: true,
            get: () => this.__data.valueCount,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Count = require('../complex_types/count.js');

                this.__data.valueCount = new Count(value);
            },
        });
        Object.defineProperty(this, 'valueDistance', {
            enumerable: true,
            get: () => this.__data.valueDistance,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Distance = require('../complex_types/distance.js');

                this.__data.valueDistance = new Distance(value);
            },
        });
        Object.defineProperty(this, 'valueDuration', {
            enumerable: true,
            get: () => this.__data.valueDuration,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Duration = require('../complex_types/duration.js');

                this.__data.valueDuration = new Duration(value);
            },
        });
        Object.defineProperty(this, 'valueHumanName', {
            enumerable: true,
            get: () => this.__data.valueHumanName,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let HumanName = require('../complex_types/humanName.js');

                this.__data.valueHumanName = new HumanName(value);
            },
        });
        Object.defineProperty(this, 'valueIdentifier', {
            enumerable: true,
            get: () => this.__data.valueIdentifier,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Identifier = require('../complex_types/identifier.js');

                this.__data.valueIdentifier = new Identifier(value);
            },
        });
        Object.defineProperty(this, 'valueMoney', {
            enumerable: true,
            get: () => this.__data.valueMoney,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Money = require('../complex_types/money.js');

                this.__data.valueMoney = new Money(value);
            },
        });
        Object.defineProperty(this, 'valuePeriod', {
            enumerable: true,
            get: () => this.__data.valuePeriod,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Period = require('../complex_types/period.js');

                this.__data.valuePeriod = new Period(value);
            },
        });
        Object.defineProperty(this, 'valueQuantity', {
            enumerable: true,
            get: () => this.__data.valueQuantity,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Quantity = require('../complex_types/quantity.js');

                this.__data.valueQuantity = new Quantity(value);
            },
        });
        Object.defineProperty(this, 'valueRange', {
            enumerable: true,
            get: () => this.__data.valueRange,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Range = require('../complex_types/range.js');

                this.__data.valueRange = new Range(value);
            },
        });
        Object.defineProperty(this, 'valueRatio', {
            enumerable: true,
            get: () => this.__data.valueRatio,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Ratio = require('../complex_types/ratio.js');

                this.__data.valueRatio = new Ratio(value);
            },
        });
        Object.defineProperty(this, 'valueReference', {
            enumerable: true,
            get: () => this.__data.valueReference,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Reference = require('../complex_types/reference.js');

                this.__data.valueReference = new Reference(value);
            },
        });
        Object.defineProperty(this, 'valueSampledData', {
            enumerable: true,
            get: () => this.__data.valueSampledData,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let SampledData = require('../complex_types/sampledData.js');

                this.__data.valueSampledData = new SampledData(value);
            },
        });
        Object.defineProperty(this, 'valueSignature', {
            enumerable: true,
            get: () => this.__data.valueSignature,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Signature = require('../complex_types/signature.js');

                this.__data.valueSignature = new Signature(value);
            },
        });
        Object.defineProperty(this, 'valueTiming', {
            enumerable: true,
            get: () => this.__data.valueTiming,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Timing = require('../backbone_elements/timing.js');

                this.__data.valueTiming = new Timing(value);
            },
        });
        Object.defineProperty(this, 'valueContactDetail', {
            enumerable: true,
            get: () => this.__data.valueContactDetail,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let ContactDetail = require('../complex_types/contactDetail.js');

                this.__data.valueContactDetail = new ContactDetail(value);
            },
        });
        Object.defineProperty(this, 'valueContributor', {
            enumerable: true,
            get: () => this.__data.valueContributor,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Contributor = require('../complex_types/contributor.js');

                this.__data.valueContributor = new Contributor(value);
            },
        });
        Object.defineProperty(this, 'valueDataRequirement', {
            enumerable: true,
            get: () => this.__data.valueDataRequirement,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let DataRequirement = require('../complex_types/dataRequirement.js');

                this.__data.valueDataRequirement = new DataRequirement(value);
            },
        });
        Object.defineProperty(this, 'valueExpression', {
            enumerable: true,
            get: () => this.__data.valueExpression,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Expression = require('../complex_types/expression.js');

                this.__data.valueExpression = new Expression(value);
            },
        });
        Object.defineProperty(this, 'valueParameterDefinition', {
            enumerable: true,
            get: () => this.__data.valueParameterDefinition,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let ParameterDefinition = require('../complex_types/parameterDefinition');

                this.__data.valueParameterDefinition = new ParameterDefinition(value);
            },
        });
        Object.defineProperty(this, 'valueRelatedArtifact', {
            enumerable: true,
            get: () => this.__data.valueRelatedArtifact,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let RelatedArtifact = require('../complex_types/relatedArtifact.js');

                this.__data.valueRelatedArtifact = new RelatedArtifact(value);
            },
        });
        Object.defineProperty(this, 'valueTriggerDefinition', {
            enumerable: true,
            get: () => this.__data.valueTriggerDefinition,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let TriggerDefinition = require('../complex_types/triggerDefinition.js');

                this.__data.valueTriggerDefinition = new TriggerDefinition(value);
            },
        });
        Object.defineProperty(this, 'valueUsageContext', {
            enumerable: true,
            get: () => this.__data.valueUsageContext,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let UsageContext = require('../complex_types/usageContext.js');

                this.__data.valueUsageContext = new UsageContext(value);
            },
        });
        Object.defineProperty(this, 'valueDosage', {
            enumerable: true,
            get: () => this.__data.valueDosage,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Dosage = require('../backbone_elements/dosage.js');

                this.__data.valueDosage = new Dosage(value);
            },
        });
        Object.defineProperty(this, 'valueMeta', {
            enumerable: true,
            get: () => this.__data.valueMeta,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Meta = require('../complex_types/meta.js');

                this.__data.valueMeta = new Meta(value);
            },
        }); // Merge in any defaults

        Object.assign(this, opts); // Define a default non-writable resourceType property

        Object.defineProperty(this, 'resourceType', {
            value: 'Extension',
            enumerable: true,
            writable: false,
        });
    }

    static get resourceType() {
        return 'Extension';
    }

    toJSON() {
        return {
            id: this.id,
            extension: this.extension && this.extension.map((v) => v.toJSON()),
            url: this.url,
            valueBase64Binary: this.valueBase64Binary,
            valueBoolean: this.valueBoolean,
            valueCanonical: this.valueCanonical,
            valueCode: this.valueCode,
            valueDate: this.valueDate,
            valueDateTime: this.valueDateTime,
            valueDecimal: this.valueDecimal,
            valueId: this.valueId,
            valueInstant: this.valueInstant,
            valueInteger: this.valueInteger,
            valueMarkdown: this.valueMarkdown,
            valueOid: this.valueOid,
            valuePositiveInt: this.valuePositiveInt,
            valueString: this.valueString,
            valueTime: this.valueTime,
            valueUnsignedInt: this.valueUnsignedInt,
            valueUri: this.valueUri,
            valueUrl: this.valueUrl,
            valueUuid: this.valueUuid,
            valueAddress: this.valueAddress && this.valueAddress.toJSON(),
            valueAge: this.valueAge && this.valueAge.toJSON(),
            valueAnnotation: this.valueAnnotation && this.valueAnnotation.toJSON(),
            valueAttachment: this.valueAttachment && this.valueAttachment.toJSON(),
            valueCodeableConcept: this.valueCodeableConcept && this.valueCodeableConcept.toJSON(),
            valueCoding: this.valueCoding && this.valueCoding.toJSON(),
            valueContactPoint: this.valueContactPoint && this.valueContactPoint.toJSON(),
            valueCount: this.valueCount && this.valueCount.toJSON(),
            valueDistance: this.valueDistance && this.valueDistance.toJSON(),
            valueDuration: this.valueDuration && this.valueDuration.toJSON(),
            valueHumanName: this.valueHumanName && this.valueHumanName.toJSON(),
            valueIdentifier: this.valueIdentifier && this.valueIdentifier.toJSON(),
            valueMoney: this.valueMoney && this.valueMoney.toJSON(),
            valuePeriod: this.valuePeriod && this.valuePeriod.toJSON(),
            valueQuantity: this.valueQuantity && this.valueQuantity.toJSON(),
            valueRange: this.valueRange && this.valueRange.toJSON(),
            valueRatio: this.valueRatio && this.valueRatio.toJSON(),
            valueReference: this.valueReference && this.valueReference.toJSON(),
            valueSampledData: this.valueSampledData && this.valueSampledData.toJSON(),
            valueSignature: this.valueSignature && this.valueSignature.toJSON(),
            valueTiming: this.valueTiming && this.valueTiming.toJSON(),
            valueContactDetail: this.valueContactDetail && this.valueContactDetail.toJSON(),
            valueContributor: this.valueContributor && this.valueContributor.toJSON(),
            valueDataRequirement: this.valueDataRequirement && this.valueDataRequirement.toJSON(),
            valueExpression: this.valueExpression && this.valueExpression.toJSON(),
            valueParameterDefinition:
                this.valueParameterDefinition && this.valueParameterDefinition.toJSON(),
            valueRelatedArtifact: this.valueRelatedArtifact && this.valueRelatedArtifact.toJSON(),
            valueTriggerDefinition:
                this.valueTriggerDefinition && this.valueTriggerDefinition.toJSON(),
            valueUsageContext: this.valueUsageContext && this.valueUsageContext.toJSON(),
            valueDosage: this.valueDosage && this.valueDosage.toJSON(),
            valueMeta: this.valueMeta && this.valueMeta.toJSON(),
        };
    }
}

module.exports = Extension;
