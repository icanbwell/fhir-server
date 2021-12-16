function compareBundles(body, expected) {
    // clear out the lastUpdated column since that changes
    // expect(body['entry'].length).toBe(2);
    delete body['timestamp'];
    body.meta.tag.forEach(tag => {
        if (tag['system'] === 'https://www.icanbwell.com/query') {
            delete tag['display'];
        }
    });
    body.entry.forEach(element => {
        delete element['resource']['meta']['lastUpdated'];
    });
    expected.meta.tag.forEach(tag => {
        if (tag['system'] === 'https://www.icanbwell.com/query') {
            delete tag['display'];
        }
    });
    expected.entry.forEach(element => {
        delete element['resource']['meta']['lastUpdated'];
        delete element['resource']['$schema'];
    });
    expect(body).toStrictEqual(expected);
}

module.exports = {
    compareBundles: compareBundles
};
