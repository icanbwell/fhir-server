import React, {useState} from 'react';
import {Button, TextField, Container, Typography} from '@mui/material';
import AdminApi from "../utils/adminApi";

const PersonPatientLinkPage: React.FC = () => {
    const [bwellPersonId, setBwellPersonId] = useState('');
    const [externalPersonId, setExternalPersonId] = useState('');
    const [patientId, setPatientId] = useState('');
    const [personId, setPersonId] = useState('');

    const handleShowLinkGraph = async (event: React.FormEvent) => {
        event.preventDefault();
        await new AdminApi().showPersonToPersonLink(bwellPersonId);
    };

    const handleCreatePersonToPersonLink = async (event: React.FormEvent) => {
        event.preventDefault();
        await new AdminApi().createPersonToPersonLink(bwellPersonId, externalPersonId);
    };

    const handleRemovePersonToPersonLink = async (event: React.FormEvent) => {
        event.preventDefault();
        await new AdminApi().removePersonToPersonLink(bwellPersonId, externalPersonId);
    };

    const handleCreatePersonToPatientLink = async (event: React.FormEvent) => {
        event.preventDefault();
        await new AdminApi().createPersonToPatientLink(externalPersonId, patientId);
    };

    const handleDeletePerson = async (event: React.FormEvent) => {
        event.preventDefault();
        await new AdminApi().deletePerson(personId);
    };

    return (
        <Container>
            <Typography variant="h3">Show Link Graph from b.well Person</Typography>
            <Typography variant="h6">See linked Person and Patient resources from a b.well Person
                (recursive)</Typography>
            <form onSubmit={handleShowLinkGraph}>
                <TextField label="b.well Person" value={bwellPersonId}
                           onChange={(e) => setBwellPersonId(e.target.value)}/>
                <Button type="submit">Show Link Graph</Button>
            </form>
            <hr/>
            <Typography variant="h3">Create Person to Person Link</Typography>
            <Typography variant="h6">Add a link from one Person resource to another Person resource</Typography>
            <form onSubmit={handleCreatePersonToPersonLink}>
                <TextField label="b.well Person" value={bwellPersonId}
                           onChange={(e) => setBwellPersonId(e.target.value)}/>
                <TextField label="External Person" value={externalPersonId}
                           onChange={(e) => setExternalPersonId(e.target.value)}/>
                <Button type="submit">Create Link</Button>
            </form>
            <hr/>
            <Typography variant="h3">Remove Person to Person Link</Typography>
            <Typography variant="h6">Remove a link from one Person resource to another Person resource</Typography>
            <form onSubmit={handleRemovePersonToPersonLink}>
                <TextField label="b.well Person" value={bwellPersonId}
                           onChange={(e) => setBwellPersonId(e.target.value)}/>
                <TextField label="External Person" value={externalPersonId}
                           onChange={(e) => setExternalPersonId(e.target.value)}/>
                <Button type="submit">Remove Link</Button>
            </form>
            <hr/>
            <Typography variant="h3">Create Person to Patient Link</Typography>
            <Typography variant="h6">Create a link from one Person resource to a Patient resource. Leave External Person
                blank to create a new Person resource with same meta tags as the Patient resource</Typography>
            <form onSubmit={handleCreatePersonToPatientLink}>
                <TextField label="External Person (leave blank to create new)" value={externalPersonId}
                           onChange={(e) => setExternalPersonId(e.target.value)}/>
                <TextField label="Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}/>
                <Button type="submit">Create Link</Button>
            </form>
            <hr/>
            <Typography variant="h3">Delete b.well Person</Typography>
            <Typography variant="h6">Delete a Person record (And remove links from other Person records)</Typography>
            <form onSubmit={handleDeletePerson}>
                <TextField label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)}/>
                <Button type="submit">Delete Person</Button>
            </form>
        </Container>
    );
};

export default PersonPatientLinkPage;
