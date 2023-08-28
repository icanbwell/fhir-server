import React from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';

const BundleMeta = ({meta}) => {
    if (!meta || !meta.tag) {
        return null;
    }

    return (
        <React.Fragment>
            <Typography variant="h5" className="mt-4">Bundle Meta</Typography>
            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>System</TableCell>
                            <TableCell>Code/Display</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {meta.tag.map((tag) => (
                            <TableRow key={tag.system}>
                                <TableCell>{tag.system}</TableCell>
                                <TableCell>{tag.code || tag.display}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </React.Fragment>
    );
};

export default BundleMeta;
