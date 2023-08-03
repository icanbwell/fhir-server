import React from 'react';
import {Box, Typography} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

const NoResults = ({options}) => {
    const hasResources = options.resources.length > 0 && options.resourceName === options.resources[0].resourceType;
    const terms = Object.keys(options.body).length;

    if (!hasResources) {
        return (
            <Box>
                <SearchIcon color="action" style={{fontSize: 40}}/>
                <Typography variant="h6">
                    {terms === 0 ? 'No Search Terms Provided' : 'No Results Found'}
                </Typography>
            </Box>
        );
    }

    // If there are resources, you would return some other JSX here.
    return null;
};

export default NoResults;
