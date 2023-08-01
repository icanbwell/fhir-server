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
}

export default SearchFormQuery;
