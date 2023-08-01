// HomePage.js
import {resourceDefinitions} from './utils/reactResourceDefinitions';
import React, {useEffect} from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';

const Home = ({resources, url, currentYear, meta}) => {
    const searchResource = (resourceName) => {
        // implementation of searchResource
    };

    const openDox = (event, resourceUrl) => {
        // prevent row click event
        event.stopPropagation();
        // implementation of openDox
    };

    useEffect(() => {
    }, []);

    return (
        <div>
            <TableContainer>
                <Table stickyHeader className="sticky-table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Resource</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {resourceDefinitions.map((resource) => (
                            <TableRow key={resource.name} onClick={() => searchResource(resource.name)}
                                      className="row-click">
                                <TableCell>{resource.name}</TableCell>
                                <TableCell className="pe-5 position-relative">
                                    {resource.description}
                                </TableCell>
                                <TableCell>
                                    <IconButton
                                        onClick={(event) => openDox(event, resource.url)}
                                        title={`FHIR Specification for ${resource.name}`}
                                    >
                                        <DescriptionIcon/>
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </div>
    );
};

export default Home;
