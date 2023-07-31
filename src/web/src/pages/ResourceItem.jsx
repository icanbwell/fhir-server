import Practitioner from './Practitioner';

function ResourceItem({resourceType, resource, index}) {
    switch (resourceType) {
        case 'Practitioner':
            return <Practitioner resource={resource} index={index}/>;
        default:
            return null;
    }
}

export default ResourceItem;
