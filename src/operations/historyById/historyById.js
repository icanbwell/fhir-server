const { ParsedArgs } = require('../query/parsedArgs');
const { BaseHistoryOperationProcessor } = require('../history/history');

class HistoryByIdOperation extends BaseHistoryOperationProcessor {
    /**
     * does a FHIR History By id
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     * @param {string} resourceType
     */
    async historyByIdAsync({ requestInfo, parsedArgs, resourceType }) {
        const { id } = parsedArgs;

        this.currentOperationName = 'historyById';
        this.errorMessagePostfix = `for ${resourceType}/${id}`;
        return this.fetchHistoryAsync({ requestInfo, parsedArgs, resourceType });
    }
}

module.exports = {
    HistoryByIdOperation
};
