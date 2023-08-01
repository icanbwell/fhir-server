import Practitioner from './Practitioner';
import Patient from './Patient';

function ResourceItem({resourceType, resource, index}) {
    console.log(`ResourceItem: resourceType=${resourceType}`);
    switch (resourceType) {
        case 'Practitioner':
            return <Practitioner resource={resource} index={index}/>;
        case 'Patient':
            return <Patient resource={resource} index={index}/>;
        default:
            return null;
    }
}

export default ResourceItem;
