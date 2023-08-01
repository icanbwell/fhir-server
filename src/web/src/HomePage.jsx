// HomePage.js
import {resourceDefinitions} from './utils/reactResourceDefinitions';
import React, {useEffect} from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, Container} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';

import {makeStyles} from '@mui/styles';
import Header from './partials/Header';
import Footer from './partials/Footer';
import {useNavigate} from 'react-router-dom';


const Home = ({resources, url, currentYear, meta}) => {
    const useStyles = makeStyles({
        row: {
            '&:nth-of-type(odd)': {
                backgroundColor: '#f2f2f2',  // Light gray for odd rows
            },
            '&:nth-of-type(even)': {
                backgroundColor: '#ffffff',  // White for even rows
            },
            cursor: 'pointer',
        },
    });

    const classes = useStyles();

    const navigate = useNavigate();

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

    // noinspection JSValidateTypes
    return (
        <Container>
            <Header resources={resourceDefinitions}/>
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
                        {resourceDefinitions.map(resource => (
                            <TableRow key={resource.name}
                                      onClick={() => {
                                          searchResource(resource.name);
                                          navigate(`/4_0_0/${resource.name}`); // navigate to the desired path
                                      }}
                                      className={classes.row}>
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
            <Footer/>
        </Container>
    );
};

export default Home;
