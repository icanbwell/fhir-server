const { textQueryBuilder } = require('../../../utils/querybuilder.util');
const { BaseFilter } = require('./baseFilter');

/**
 * @classdesc Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 */
class FilterByText extends BaseFilter {

    filterText() {
        const and_segments = [];

        if (this.parsedArg.queryParameterValue.values) {
            and_segments.push({
                $or: this.propertyObj.fields.flatMap((field) => {
                    return {
                        [this.parsedArg.queryParameterValue.operator]:
                            this.parsedArg.queryParameterValue.values.flatMap(v => {
                                if (field === 'identifier') {
                                    return {
                                        $or: [
                                            // search in identifier type text
                                            textQueryBuilder(
                                                {
                                                    field: this.fieldMapper.getFieldName(`${field}.type.text`),
                                                    text: this.parsedArg.queryParameterValue.value,
                                                    ignoreCase: true
                                                }
                                            )
                                        ]
                                    };
                                }
                                return {
                                    $or: [
                                        // search in code text field
                                        textQueryBuilder(
                                            {
                                                field: this.fieldMapper.getFieldName(`${field}.text`),
                                                text: this.parsedArg.queryParameterValue.value,
                                                ignoreCase: true
                                            }
                                        ),
                                        // search in code display field for every coding
                                        textQueryBuilder(
                                            {
                                                field: this.fieldMapper.getFieldName(`${field}.coding.display`),
                                                text: this.parsedArg.queryParameterValue.value,
                                                ignoreCase: true
                                            }
                                        )
                                    ]
                                };
                            })
                    };
                })
            }
            );
        }
        return and_segments;
    }
}

module.exports = {
    FilterByText
};
