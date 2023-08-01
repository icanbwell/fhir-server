import {Button, Card, CardContent, CardHeader, Collapse} from '@mui/material';
import ResourceHeader from '../partials/ResourceHeader';
import ResourceItem from './ResourceItem';
import Json from '../partials/Json';
import React, {useState} from 'react';
import {makeStyles} from '@mui/styles';

const useStyles = makeStyles({
    header: {
        // backgroundColor: 'lightgray', // Light gray background color
        // color: 'darkslategray',
        fontSize: '1.5em',          // Text size
        // add more styles as you wish
    },
});

const ResourceCard = ({index, resource}) => {
    const classes = useStyles();
    const [open, setOpen] = useState(false);

    const handleOpen = () => {
        setOpen(!open);
    };
    return (
        <Card key={index}>
            <CardHeader title={`(${index + 1}) ${resource.resourceType}/${resource.id}`}
                        classes={{title: classes.header}}
                        action={
                            <Button onClick={handleOpen}>
                                {open ? 'Close' : 'Open'}
                            </Button>
                        }>
            </CardHeader>
            <Collapse in={open}>
                <CardContent>
                    <ResourceHeader resource={resource}/>
                    <ResourceItem resourceType={resource.resourceType} resource={resource} index={index}/>
                    <Json index={index} resource={resource}/>
                </CardContent>
            </Collapse>
        </Card>
    );
};

export default ResourceCard;
