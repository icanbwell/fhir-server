class RequestInfo {
    /**
     * class that holds request info
     * @param {string | null} user
     * @param {string} scope
     * @param {string} protocol
     * @param {string} originalUrl
     * @param {string | null} remoteIpAddress
     * @param {string|null} requestId
     * @param {string | null} path
     * @param {string | null} host
     * @param {Object | Object[] | null} body
     * @param {string | null} accept
     * @param {boolean | null} isUser
     * @param {string[] | null} patients
     * @param {string | null} fhirPersonId
     */
    constructor(user,
                scope,
                remoteIpAddress,
                requestId,
                protocol,
                originalUrl,
                path,
                host,
                body,
                accept,
                isUser,
                patients,
                fhirPersonId) {
        /**
         * @type {string|null}
         */
        this.user = user;
        /**
         * @type {string}
         */
        this.scope = scope;
        /**
         * @type {string|null}
         */
        this.remoteIpAddress = remoteIpAddress;
        /**
         * @type {string|null}
         */
        this.requestId = requestId;
        /**
         * @type {string}
         */
        this.protocol = protocol;
        /**
         * @type {string}
         */
        this.originalUrl = originalUrl;
        /**
         * @type {string|null}
         */
        this.path = path;
        /**
         * @type {string|null}
         */
        this.host = host;
        /**
         * @type {Object|Object[]|null}
         */
        this.body = body;
        /**
         * @type {string | null}
         */
        this.accept = accept;
        /**
         * @type {boolean}
         */
        this.isUser = isUser;
        /**
         * @type {string[] | null}
         */
        this.patients = patients;
        /**
         * @type {string | null}
         */
        this.fhirPersonId = fhirPersonId;
    }
}

module.exports = {
    RequestInfo
};
