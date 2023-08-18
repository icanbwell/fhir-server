import React from 'react';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import SearchFormQuery from '../utils/searchFormQuery';

export default function SearchBox({onSearch, resourceType}) {
    const [searchText, setSearchText] = React.useState('');

    const handleTextChange = (setText) => (event) => {
        setText(event.target.value);
    };

    const search = () => {
        onSearch(
            new SearchFormQuery(
                {
                    chatGptQuestion: searchText
                }
            )
        );
    };

    return (
        <Box
            component="form"
            noValidate
            autoComplete="off"
        >
            <Grid container spacing={2}>
                <Grid item xs={12}>
                    <TextField
                        name="question"
                        label="Question"
                        type="text"
                        value={searchText}
                        onChange={handleTextChange(setSearchText)}
                        fullWidth
                        multiline
                        rows={4}
                    />
                </Grid>
                <Grid item xs={12}>
                    <Button variant="contained" color="primary" onClick={search}>
                        Search
                    </Button>
                </Grid>
            </Grid>
        </Box>
    );
}
