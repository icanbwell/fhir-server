import React from 'react';
import {Box, Typography} from '@mui/material';

const OperationOutcome = ({resource, admin, index}) => {

    return (
        <Box>
            <Typography variant="h4">Issues</Typography>
            {
                resource.issue && resource.issue.map((issue, index) =>
                    (
                        <Box key={index}>
                            <Box>Severity: {issue.severity}</Box>
                            <Box>Code: {issue.code}</Box>
                            <Box>{issue.diagnostics}</Box>
                        </Box>
                    )
                )
            }
        </Box>
    );
};

export default OperationOutcome;
