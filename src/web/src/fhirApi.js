class FhirApi {
    async getPatientEverythingAsync({patientId, question}) {
        const urlEncodedQuestion = encodeURIComponent(question);
        const url = `/4_0_0/Patient/${patientId}/$everything?_question=${urlEncodedQuestion}`;
        const response = await fetch(url,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
            });
        return await response.json();
    }

    async getResource({id, resourceType}) {
        const url = `/4_0_0/${resourceType}/${id}/`;
        const response = await fetch(url,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
            });
        return await response.json();
    }

    /**
     * gets fhir bundle
     * @param {string} resourceType
     * @param {string} [query]
     * @returns {Promise<any>}
     */
    async getBundleAsync({resourceType, query}) {
        const url = `/4_0_0/${resourceType}` + (query ? `?${query}` : '');
        const response = await fetch(url,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
            });
        return await response.json();
    }
}

export default FhirApi;