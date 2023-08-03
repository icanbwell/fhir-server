import React from 'react';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';

const Code = ({name, value}) => {
    if (!value) {
        return null;
    }

    return (
        <div>
            <Typography variant="body1" component="span">
                <b>{name}:</b>&nbsp;
            </Typography>
            <Link href={value}>
                {value}
            </Link>
        </div>
    );
};

export default Code;
