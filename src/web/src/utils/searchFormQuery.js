class SearchFormQuery {
    /**
     * contains the query parameters for the search form
     * @param {Date|undefined} start
     * @param {Date|undefined} end
     * @param {string|undefined} givenName
     * @param {string|undefined} familyName
     * @param {string|undefined} email
     * @param {string|undefined} security
     * @param {string|undefined} id
     * @param {string|undefined}identifier
     * @param {string|undefined}source
     */
    constructor(
        {
            start,
            end,
            givenName,
            familyName,
            email,
            security,
            id,
            identifier,
            source
        }
    ) {
        this.start = start;
        this.end = end;
        this.givenName = givenName;
        this.familyName = familyName;
        this.email = email;
        this.security = security;
        this.id = id;
        this.identifier = identifier;
        this.source = source;
    }

    /**
     * returns the query parameters as an array of strings
     * @returns {string[]}
     */
    getQueryParameters() {
        const queryParameters = [];
        if (this.start) {
            queryParameters.push(`_lastUpdated=gt${this.start.toISOString()}`);
        }
        if (this.end) {
            queryParameters.push(`_lastUpdated=lt${this.end.toISOString()}`);
        }
        if (this.givenName) {
            queryParameters.push(`given=${this.givenName}`);
        }
        if (this.familyName) {
            queryParameters.push(`family=${this.familyName}`);
        }
        if (this.email) {
            queryParameters.push(`email=${this.email}`);
        }
        if (this.security) {
            queryParameters.push(`_security=${this.security}`);
        }
        if (this.id) {
            queryParameters.push(`id=${this.id}`);
        }
        if (this.identifier) {
            queryParameters.push(`identifier=${this.identifier}`);
        }
        if (this.source) {
            queryParameters.push(`_source=${this.source}`);
        }
        return queryParameters;
    }
}

export default SearchFormQuery;
