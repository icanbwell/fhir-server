import React, {useState} from 'react';
import {Button, TextField, Container, Typography, Box, Select, MenuItem, FormControl, InputLabel} from '@mui/material';
import AdminApi from "../utils/adminApi";

const PersonMatchPage: React.FC = () => {
    const [sourceId, setSourceId] = useState<string>('');
    const [sourceType, setSourceType] = useState<string>('Patient');
    const [targetId, setTargetId] = useState<string>('');
    const [targetType, setTargetType] = useState<string>('Patient');

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const response = new AdminApi().runPersonMatch(
            {
                sourceId, sourceType, targetId, targetType
            }
        );
        console.log(response);
    };

    return (
        <Container maxWidth="sm">
            <Typography variant="h3">Run a Person Match diagnostic test</Typography>
            <Typography variant="h6">Calls Person Matching service to give a diagnostic report on trying to match these
                two records</Typography>
            <Box component="form" onSubmit={handleSubmit} noValidate sx={{mt: 1}}>
                <FormControl fullWidth>
                    <InputLabel id="sourceType-label">Source Type</InputLabel>
                    <Select
                        labelId="sourceType-label"
                        id="sourceType"
                        value={sourceType}
                        label="Source Type"
                        onChange={(event) => setSourceType(event.target.value)}
                    >
                        <MenuItem value="Patient">Patient</MenuItem>
                        <MenuItem value="Person">Person</MenuItem>
                    </Select>
                </FormControl>
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    id="sourceId"
                    label="Source Id"
                    name="sourceId"
                    autoComplete="off"
                    autoFocus
                    value={sourceId}
                    onChange={(event) => setSourceId(event.target.value)}
                />
                <FormControl fullWidth>
                    <InputLabel id="targetType-label">Target Type</InputLabel>
                    <Select
                        labelId="targetType-label"
                        id="targetType"
                        value={targetType}
                        label="Target Type"
                        onChange={(event) => setTargetType(event.target.value)}
                    >
                        <MenuItem value="Patient">Patient</MenuItem>
                        <MenuItem value="Person">Person</MenuItem>
                    </Select>
                </FormControl>
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    id="targetId"
                    label="Target Id"
                    name="targetId"
                    autoComplete="off"
                    autoFocus
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                />
                <Button type="submit" fullWidth variant="contained" sx={{mt: 3, mb: 2}}>
                    Run Person Matching Service
                </Button>
            </Box>
        </Container>
    );
};

export default PersonMatchPage;
