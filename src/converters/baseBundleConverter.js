class BaseBundleConverter{
    /**
     * convert
     * @param {Object} bundle
     * @return {Buffer}
     */
    convert({bundle}) {
        throw new Error("convert method not implemented");
    }
}

module.exports = {
    BaseBundleConverter
};
