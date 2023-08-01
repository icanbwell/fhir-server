import React, {useState} from 'react';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import {DatePicker} from '@mui/x-date-pickers/DatePicker';

export default function SearchForm() {
    const [start, setStart] = React.useState('');
    const [end, setEnd] = React.useState('');
    const [text1, setText1] = useState("");
    const [text2, setText2] = useState("");

    const handleTextChange = (setText) => (event) => {
        setText(event.target.value);
    };

    const resetFields = () => {
        setStart(null);
        setEnd(null);
        setText1("");
        setText2("");
    };

    const search = () => {
        // Perform search with dateRange, text1, and text2
        console.log(start, end, text1, text2);
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
                        label="Start"
                        value={start}
                        onChange={(newValue) => setStart(newValue)}
                    />
                    <DatePicker
                        label="End"
                        value={end}
                        onChange={(newValue) => setEnd(newValue)}
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                        name="text1"
                        label="Text 1"
                        type="text"
                        value={text1}
                        onChange={handleTextChange(setText1)}
                        fullWidth
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                        name="text2"
                        label="Text 2"
                        type="text"
                        value={text2}
                        onChange={handleTextChange(setText2)}
                        fullWidth
                    />
                </Grid>
            </Grid>
            <Button variant="contained" color="primary" onClick={search}>
                Search
            </Button>
            <Button variant="outlined" color="secondary" onClick={resetFields}>
                Reset
            </Button>
        </Box>
    );
}
