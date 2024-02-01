function searchResource(resourceName) {
    window.location.assign(`/4_0_0/${resourceName}/_search?_keepOldUI=1`);
}

function openDox(event, url) {
    if (event) {
        event.stopPropagation();
    }
    window.open(url, '_blank');
}
