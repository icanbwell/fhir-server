class BaseBundleConverter{
    /**
     * convert
     * @param {Bundle} bundle
     */
    convert({bundle}) {
        throw new Error("convert method not implemented");
    }
}

module.exports = {
    BaseBundleConverter
};
