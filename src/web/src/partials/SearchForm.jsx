import React, {useState} from 'react';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import {DatePicker} from '@mui/x-date-pickers/DatePicker';
import SearchFormQuery from '../utils/searchFormQuery';

export default function SearchForm({onSearch, resourceType}) {
    const [start, setStart] = React.useState('');
    const [end, setEnd] = React.useState('');
    const [givenName, setGivenName] = useState("");
    const [familyName, setFamilyName] = useState("");
    const [email, setEmail] = useState("");
    const [security, setSecurity] = useState("");
    const [id, setId] = useState("");
    const [identifier, setIdentifier] = useState("");
    const [source, setSource] = useState("");

    const handleTextChange = (setText) => (event) => {
        setText(event.target.value);
    };

    const resetFields = () => {
        setStart(null);
        setEnd(null);
        setGivenName("");
        setFamilyName("");
        setEmail("");
        setSecurity("");
        setId("");
        setIdentifier("");
        setSource("");
    };

    const search = () => {
        // Perform search with dateRange, givenName, and familyName
        onSearch(
            new SearchFormQuery(
                {
                    start,
                    end, givenName,
                    familyName,
                    email,
                    security,
                    id,
                    identifier,
                    source
                }
            )
        );
    };

    return (
        <Box
            component="form"
            sx={{
                '& .MuiTextField-root': {m: 1, width: {xs: '90%', sm: '25ch'}},
            }}
            noValidate
            autoComplete="off"
        >
            <Grid container spacing={2}>
                <Grid item xs={12}>
                    <DatePicker
                        label="Last Updated After"
                        value={start}
                        onChange={(newValue) => setStart(newValue)}
                    />
                    <DatePicker
                        label="Last Updated Before"
                        value={end}
                        onChange={(newValue) => setEnd(newValue)}
                    />
                    <TextField
                        name="givenName"
                        label="Given (Name)"
                        type="text"
                        value={givenName}
                        onChange={handleTextChange(setGivenName)}
                        fullWidth
                    />
                    <TextField
                        name="familyName"
                        label="Family (Name)"
                        type="text"
                        value={familyName}
                        onChange={handleTextChange(setFamilyName)}
                        fullWidth
                    />
                    <TextField
                        name="email"
                        label="Email"
                        type="text"
                        value={email}
                        onChange={handleTextChange(setEmail)}
                        fullWidth
                    />
                    <TextField
                        name="security"
                        label="Security"
                        type="text"
                        value={security}
                        onChange={handleTextChange(setSecurity)}
                        fullWidth
                    />
                    <TextField
                        name="id"
                        label="Id"
                        type="text"
                        value={id}
                        onChange={handleTextChange(setId)}
                        fullWidth
                    />
                    <TextField
                        name="identifier"
                        label="Identifier"
                        type="text"
                        value={identifier}
                        onChange={handleTextChange(setIdentifier)}
                        fullWidth
                    />
                    <TextField
                        name="source"
                        label="Source"
                        type="text"
                        value={source}
                        onChange={handleTextChange(setSource)}
                        fullWidth
                    />
                </Grid>
            </Grid>
            <Button variant="outlined" color="secondary" onClick={resetFields}>
                Reset
            </Button>
            <Button variant="contained" color="primary" onClick={search}>
                Search
            </Button>
        </Box>
    );
}
