import Practitioner from './Practitioner';

function ResourceItem({resourceType, resource, index}) {
    console.log(`ResourceItem: resourceType=${resourceType}`);
    switch (resourceType) {
        case 'Practitioner':
            return <Practitioner resource={resource} index={index}/>;
        default:
            return null;
    }
}

export default ResourceItem;
