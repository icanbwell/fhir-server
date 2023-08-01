import {Card, CardContent, CardHeader} from '@mui/material';
import ResourceHeader from '../partials/ResourceHeader';
import ResourceItem from './ResourceItem';
import Json from '../partials/Json';
import React from 'react';
import {makeStyles} from '@mui/styles';

const useStyles = makeStyles({
    header: {
        backgroundColor: 'lightgray', // Light gray background color
        color: 'darkslategray',
        fontSize: '2em',          // Text size
        // add more styles as you wish
    },
});

const ResourceCard = ({index, resource}) => {
    const classes = useStyles();
    return (
        <Card key={index}>
            <CardHeader title={`(${index + 1}) ${resource.resourceType}/${resource.id}`}
                        classes={{title: classes.header}}>
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
