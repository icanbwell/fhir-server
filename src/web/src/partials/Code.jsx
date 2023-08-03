import React from 'react';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import {Box} from '@mui/material';

const Code = ({name, value}) => {
    if (!value) {
        return null;
    }

    return (
        <Box>
            <Typography variant="body1" component="span">
                <b>{name}:</b>&nbsp;
            </Typography>
            <Link href={value}>
                {value}
            </Link>
        </Box>
    );
};

export default Code;
