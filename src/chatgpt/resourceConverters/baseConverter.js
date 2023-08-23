class BaseConverter {
    /**
     * converts a FHIR resource to summary text
     * @param {Resource} resource
     * @returns {string}
     */
    // eslint-disable-next-line no-unused-vars
    convert({resource}) {
        throw new Error('Not Implemented by subclass');
    }

    getDisplayText(codingArray) {
        const coding = codingArray ? codingArray.find((item) => item.display) : undefined;
        return coding ? coding.display : '';
    }

    formatDate(dateString) {
        if (!dateString) {
            return '';
        }
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
    }

    /**
     * if value is defined then it formats the template with the value and returns it otherwise returns undefined
     * @param {string} template
     * @param {*} value
     * @return {string}
     */
    addSafeText({template, value}) {
        if (value) {
            return template;
        }
    }
}

module.exports = {
    BaseConverter
};
