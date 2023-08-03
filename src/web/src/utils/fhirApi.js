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
     * @param {string[]|undefined} queryParameters
     * @returns {Promise<{status: number, json: Object}>}
     */
    async getBundleAsync({resourceType, id, queryString, queryParameters}) {
        let urlString = `/4_0_0/${resourceType}`;
        if (id) {
            urlString += `/${id}/`;
        }

        function stripFirstCharIfQuestionMark(str) {
            if (str.charAt(0) === '?') {
                return str.slice(1);
            }
            return str;
        }

        if (queryString) {
            urlString += `?${stripFirstCharIfQuestionMark(queryString)}`;
        }
        const url = new URL(urlString, window.location.origin);
        if (queryParameters && queryParameters.length > 0) {
            queryParameters.forEach(queryParameter => {
                const [name, value] = queryParameter.split('=');
                url.searchParams.append(name, value);
            });
        }
        // add limit of 10 for results
        if (!url.searchParams.has('_count')) {
            url.searchParams.append('_count', 10);
        }

        const response = await fetch(url.toString(),
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
            });
        const status = response.status;
        if (status === 404 || status === 401) {
            return {status, json: {}};
        }
        const responseJson = await response.json();
        return {status, json: responseJson};
    }
}

export default FhirApi;
