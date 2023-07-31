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
     * @param {string} id
     * @param {string} [query]
     * @returns {Promise<{status: number, json: Object}>}
     */
    async getBundleAsync({resourceType, id, query}) {
        const url = `/4_0_0/${resourceType}` + (id ? `/${id}/` : '') + (query ? `?${query}` : '');
        const response = await fetch(url,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
            });
        const status = response.status;
        const responseJson = await response.json();
        return {status, json: responseJson};
    }
}

export default FhirApi;
