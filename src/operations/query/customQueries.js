/**
 * This file defines the filters types
 */
/**
 * This is the enum for the types of filters we support
 * @type {Object.<string, SearchParameterDefinitionType>}
 */
const fhirFilterTypes = {
    /**
     * example usage: ?param=id1 where id1 is the id of the resource we're finding references to
     */
    reference: 'reference',
    /**
     * example usage: ?param={system}|{code} will require both to match
     * example usage: ?param={system}| will match only on system
     * example usage: ?param=code will match only on code
     */
    token: 'token',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    date: 'date',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    datetime: 'datetime',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    instant: 'instant',
    /**
     * example usage: ?param=lt{date}&date=gt{date}
     * can also pass in exact date e.g., ?param={date}
     */
    period: 'period',
    /**
     *     example usage: ?param=bar
     *     can also pass in multiple values separated by comma which are combined in an OR e.g., ?param=bar1,bar2
     */
    string: 'string',
    /**
     *     example usage: ?param=bar
     *     can also pass in multiple values separated by comma which are combined in an OR e.g., ?param=bar1,bar2
     */
    uri: 'uri',
    /**
     * usage: ?param=imran@hotmail.com
     */
    email: 'email',
    /**
     * usage: ?param=4086669999
     */
    phone: 'phone',
    /**
     * usage: ?param=url
     */
    canonical: 'canonical',
    /**
     * usage: ?param=<lt...>number|system|code
     */
    quantity: 'quantity',
    /**
     * usage: ?param=<lt...>number
     */
    number: 'number'
};

const vulcanIgSearchQueries = {
    Patient: {
        condition: {
            filters: [
                {
                    resourceType: 'Condition',
                    searchParam: 'code',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                }
            ],
            resultSearchParam: 'id'
        },
        "condition-clinical-status": {
            filters: [
                {
                    resourceType: 'Condition',
                    searchParam: 'clinical-status',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                }
            ],
            resultSearchParam: 'id'
        },
        "condition-verification-status": {
            filters: [
                {
                    resourceType: 'Condition',
                    searchParam: 'verification-status',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                }
            ],
            resultSearchParam: 'id'
        },
        "condition-onset-date": {
            filters: [
                {
                    resourceType: 'Condition',
                    searchParam: 'onset-date',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                }
            ],
            resultSearchParam: 'id'
        },
        medication: {
            filters: [
                {
                    resourceType: 'MedicationStatement',
                    searchParam: 'code',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                },
                {
                    resourceType: 'MedicationAdministration',
                    searchParam: 'code',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                },
                {
                    resourceType: 'MedicationDispense',
                    searchParam: 'code',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                },
                {
                    resourceType: 'MedicationRequest',
                    searchParam: 'code',
                    filterField: 'subject._uuid',
                    extractValueFn: "return x.split('/')[1]"
                }
            ],
            resultSearchParam: 'id'
        }
    }
};

module.exports = {
    fhirFilterTypes,
    vulcanIgSearchQueries
};
