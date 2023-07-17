class BaseConverter {
    /**
     * converts Patient resource to text
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
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
    }
}

module.exports = {
    BaseConverter
};
