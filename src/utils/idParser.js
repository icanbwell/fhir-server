class IdParser {
    /**
     * Parses id string
     * The id can be '123|client' or '123'
     * @param {string} id
     * @return {{ id: string, sourceAssigningAuthority: string|undefined}}
     */
    static parse (id) {
        let id1;
        let sourceAssigningAuthority;

        const idParts = id.split('|');
        if (idParts.length > 1) {
            id1 = idParts[0];
            sourceAssigningAuthority = idParts[1];
        } else {
            id1 = id;
        }

        return { id: id1, sourceAssigningAuthority };
    }
}

module.exports = {
    IdParser
};
