function searchResource(resourceName) {
    const url = new URL(`/4_0_0/${resourceName}/_search`, window.location.origin);
    url.search = new URLSearchParams('_keepOldUI=1');
    window.location.assign(url.toString());
}

function openDox(event, url) {
    if (event) {
        event.stopPropagation();
    }
    window.open(url, '_blank');
}
