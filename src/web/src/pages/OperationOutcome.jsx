import React from 'react';
import {Box, Typography} from '@mui/material';
import Reference from '../partials/Reference';

const OperationOutcome = ({resource, admin, index}) => {

    return (
        <Box>
            <Typography variant="h4">Issues</Typography>
            {
                resource.issue && resource.issue.map((issue, index) =>
                    (
                        <Box key={index}>
                            {issue.severity} {issue.code} {issue.diagnostics}
                        </Box>
                    )
                )
            }
        </Box>
    );
};

export default OperationOutcome;
