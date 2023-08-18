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
     * @param {string|undefined} [id]
     * @param {string} [queryString]
     * @param {string[]|undefined} [queryParameters]
     * @returns {Promise<{status: number, json: Object}>}
     */
    async getBundleAsync({resourceType, id, queryString, queryParameters}) {
        const url = this.getUrl({resourceType, id, queryString, queryParameters});

        const response = await fetch(url.toString(),
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                cache: 'no-store' // This will bypass the cache so when we click back button the browser does not show the json
            });
        const status = response.status;
        if (status === 404 || status === 401) {
            return {status, json: {}};
        }
        const responseJson = await response.json();
        return {status, json: responseJson};
    }

    /**
     * gets url based on resource type and query parameters
     * @param {string} resourceType
     * @param {string|undefined} [id]
     * @param {string} [queryString]
     * @param {string[]|undefined} [queryParameters]
     * @returns {URL}
     */
    getUrl({resourceType, id, queryString, queryParameters}) {
        let urlString = `/4_0_0/${resourceType}`;
        if (id) {
            urlString += `/${id}`;
        }
        if (queryParameters && queryParameters.find(a => a.startsWith('_question'))) {
            urlString += `/$everything`;
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
        return url;
    }
}

export default FhirApi;
