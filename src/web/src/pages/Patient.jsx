import ResourceHeader from '../partials/ResourceHeader';

const Patient = ({resource}) => {
    return (
        <div>
            <div>resourceType: {resource.resourceType}</div>
            <div>id: {resource.id}</div>
            <ResourceHeader resource={resource} />
        </div>
    );

};

export default Patient;
