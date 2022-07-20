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

const tableHeaders = document.querySelectorAll('th[data-field]');
tableHeaders.forEach((th) => {
    th.addEventListener('click', () => {
        const field = th.getAttribute('data-field');
        sortByField(field);
    });
});

function sortByField(fieldName) {
    const sortElement = document.querySelector('input[name=_sort]');
    sortElement.value =
        sortElement.value === fieldName ?
            `-${fieldName}` :
            sortElement.value === `-${fieldName}` ? '' : fieldName;
    submitSearchForm();
}
