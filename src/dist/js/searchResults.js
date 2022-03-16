const searchResultRows = document.querySelectorAll('.row-click');
searchResultRows.forEach((row) => {
    row.addEventListener('click', rowClick);
});

function rowClick(event) {
    const dataset = event.target.closest('tr').dataset;
    const identifier = dataset.identifier;
    const url = window.location.pathname.replace('/_search', `/${identifier}`);
    window.open(url, '_blank');
}
