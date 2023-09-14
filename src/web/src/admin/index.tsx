import React from 'react';
import {Link} from 'react-router-dom';
import {Container, Typography, List, ListItem, Divider} from '@mui/material';

const AdminIndexPage: React.FC = () => {
    return (
        <Container maxWidth="sm">
            <Typography variant="h1">Admin Tools</Typography>
            <List>
                <ListItem><Link to="/admin/searchLog">Search Log</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/personPatientLink">Person Linkage</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/patientData">Show/Delete Patient Data</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/personMatch">Run Person Matching test</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/indexes">Show Indexes</Link></ListItem>
                <ListItem><Link to="/admin/indexProblems">Show Index Problems</Link></ListItem>
                <ListItem><Link to="/admin/synchronizeIndexes">Synchronize Indexes (Clicking this will kick off the
                    process)</Link></ListItem>
                <Divider/>
                <ListItem><Link to="/admin/indexes?audit=1">Show Audit Indexes</Link></ListItem>
                <ListItem><Link to="/admin/indexProblems?audit=1">Show Audit Index Problems</Link></ListItem>
                <ListItem><Link to="/admin/synchronizeIndexes?audit=1">Synchronize Audit Indexes (Clicking this will
                    kick off the process)</Link></ListItem>
            </List>
        </Container>
    );
};

export default AdminIndexPage;
