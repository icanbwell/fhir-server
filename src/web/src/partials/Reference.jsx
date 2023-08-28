import React from 'react';
import { Typography, Link, Box } from '@mui/material';

function Reference({ references = [], name }) {
    // Ensure that references is an array
    if (!Array.isArray(references)) {
        references = [references];
    }

    return (
        references && references.length > 0 && references[0] ? (
            <Box>
                <Typography variant="h4">{name}</Typography>
                {references.map((reference, index) => (
                    reference ? (
                        <Link href={`/4_0_0/${reference.reference}`} key={index}>
                            {reference.display || reference.reference}
                        </Link>
                    ) : null
                ))}
            </Box>
        ) : null
    );
}

export default Reference;
