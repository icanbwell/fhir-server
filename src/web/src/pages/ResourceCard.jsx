import {Card, CardContent, CardHeader} from '@mui/material';
import ResourceHeader from '../partials/ResourceHeader';
import ResourceItem from './ResourceItem';
import Json from '../partials/Json';
import React from 'react';

const ResourceCard = ({index, resource}) => {
    return (
        <Card key={index}>
            <CardHeader title={`(${index + 1}) ${resource.resourceType}/${resource.id}`}>
            </CardHeader>
            <CardContent>
                <ResourceHeader resource={resource}/>
                <ResourceItem resourceType={resource.resourceType} resource={resource} index={index}/>
                <Json index={index} resource={resource}/>
            </CardContent>
        </Card>
    );
};

export default ResourceCard;
