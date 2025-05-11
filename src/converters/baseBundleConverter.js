class BaseBundleConverter{
    /**
     * convert
     * @param {Object} bundle
     * @return {Buffer}
     */
    convert({bundle}) {
        throw new Error("convert method not implemented");
    }

    /**
     * convert
     * @param {Object[]} resources
     * @return {Buffer}
     */
    convertResources({resources}) {
        throw new Error("convert method not implemented");
    }
}

module.exports = {
    BaseBundleConverter
};
