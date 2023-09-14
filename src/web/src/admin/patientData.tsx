import React, { useState } from 'react';
import { Button, TextField, Container, Typography } from '@mui/material';
import AdminApi from "../utils/adminApi";

const PatientDataPage: React.FC = () => {
  const [patientId, setPatientId] = useState('');
  const [personId, setPersonId] = useState('');

  const handlePatientDataSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
      await new AdminApi().getEverythingForPatient(patientId);
  };

  const handleDeletePatientDataSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
      await new AdminApi().deletePatient(patientId);
  };

  const handlePersonDataSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
      await new AdminApi().getEverythingForPerson(personId);
  };

  const handleDeletePersonDataSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
      await new AdminApi().deletePerson(personId);
  };

  return (
    <Container maxWidth="sm">
      <Typography variant="h1">Patient</Typography>
      <Typography variant="h3">Show Patient Data Graph</Typography>
      <Typography variant="h6">Shows the graph of patient data (same as $everything endpoint)</Typography>
      <form onSubmit={handlePatientDataSubmit}>
        <TextField label="Patient Id" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
        <Button type="submit" variant="contained" color="primary">Show Patient Data</Button>
      </form>
      <Typography variant="h3">Delete Patient Data Graph</Typography>
      <Typography variant="h6">Deletes the graph of patient data (CONFIRM YOU ARE DOING THIS FOR THE CORRECT PATIENT)</Typography>
      <form onSubmit={handleDeletePatientDataSubmit}>
        <TextField label="Patient Id" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
        <Button type="submit" variant="contained" color="primary">Delete Patient Data</Button>
      </form>
      <Typography variant="h1">Person</Typography>
      <Typography variant="h3">Show Person Data Graph</Typography>
      <Typography variant="h6">Shows the graph of person data (same as $everything endpoint)</Typography>
      <form onSubmit={handlePersonDataSubmit}>
        <TextField label="Person Id" value={personId} onChange={(e) => setPersonId(e.target.value)} />
        <Button type="submit" variant="contained" color="primary">Show Person Data</Button>
      </form>
      <Typography variant="h3">Delete Person Data Graph</Typography>
      <Typography variant="h6">Deletes the graph of person data (CONFIRM YOU ARE DOING THIS FOR THE CORRECT PERSON)</Typography>
      <form onSubmit={handleDeletePersonDataSubmit}>
        <TextField label="Person Id" value={personId} onChange={(e) => setPersonId(e.target.value)} />
        <Button type="submit" variant="contained" color="primary">Delete Person Data</Button>
      </form>
    </Container>
  );
};

export default PatientDataPage;
