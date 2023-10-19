import React from 'react';
import {
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Box,
    Link,
} from '@mui/material';

const DiagnosticReportMedia = ({ medias, name }) => {
    // Ensure medias is always an array
    if (!Array.isArray(medias)) {
        medias = [medias];
    }

    if (medias && medias.length > 0 && medias[0]) {
        return (
            <Box>
                <Typography variant="h4">{name}</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Id</TableCell>
                                <TableCell>Link</TableCell>
                                <TableCell>Comment</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {medias.map(
                                (media, index) =>
                                    media && (
                                        <TableRow key={index}>
                                            <TableCell>{media.id}</TableCell>
                                            <TableCell>
                                                {media.link?.reference ? (
                                                    <Link href={media.link.reference} key={index}>
                                                        {media.link.reference}
                                                    </Link>
                                                ) : (
                                                    ''
                                                )}
                                            </TableCell>
                                            <TableCell>{media.comment}</TableCell>
                                        </TableRow>
                                    )
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        );
    }

    // In case there are no medias, we return null, not to render anything
    return null;
};

export default DiagnosticReportMedia;
