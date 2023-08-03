import React from 'react';
import {Typography, Link, Box} from '@mui/material';

function ReverseReference({name, id, reverseReferences}) {
    // Ensure reverseReferences is an array
    if (!Array.isArray(reverseReferences)) {
        reverseReferences = [reverseReferences];
    }

    return (
        reverseReferences && reverseReferences.length > 0 && reverseReferences[0] ? (
            <Box>
                <Typography variant="h4">{name}</Typography>
                {
                    reverseReferences.map((reference, index) =>
                        reference ? (
                            <Link
                                key={index}
                                href={`/4_0_0/${reference.target}?${reference.property}=${id}`}
                            >
                                {`/4_0_0/${reference.target}?${reference.property}=${id}`}
                            </Link>
                        ) : null
                    )
                }
            </Box>
        ) : null
    );
}

export default ReverseReference;

