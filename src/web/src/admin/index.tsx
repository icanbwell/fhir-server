import React from 'react';
import {Link} from 'react-router-dom';
import {Container, Typography, List, ListItem, Divider} from '@mui/material';

const AdminIndexPage: React.FC = () => {
    return (
        <Container maxWidth="sm">
            <Typography variant="h2">Admin Tools</Typography>
            <List>
                <ListItem><Link to="/admin/searchLog">Search Log</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/personPatientLink">Person Linkage</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/patientData">Show/Delete Patient Data</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/personMatch">Run Person Matching test</Link></ListItem>
                <Divider/>
            </List>
        </Container>
    );
};

export default AdminIndexPage;
