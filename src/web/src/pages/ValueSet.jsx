import React from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';

function ValueSet({resource}) {
    return (
        <>
            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Field</TableCell>
                            <TableCell>Value</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>{resource.name}</TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>url</TableCell>
                            <TableCell><a href={resource.url}>{resource.url}</a></TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>version</TableCell>
                            <TableCell>{resource.version}</TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>status</TableCell>
                            <TableCell>{resource.status}</TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>date</TableCell>
                            <TableCell>{resource.date}</TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>publisher</TableCell>
                            <TableCell>{resource.publisher}</TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>

            {resource.expansion && resource.expansion.contains && (
                <>
                    <Typography variant="h4">Contains</Typography>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>system</TableCell>
                                    <TableCell>code</TableCell>
                                    <TableCell>display</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.expansion.contains.map((contains) => (
                                    <TableRow key={contains.code}>
                                        <TableCell>{contains.system}</TableCell>
                                        <TableCell>{contains.code}</TableCell>
                                        <TableCell>{contains.display}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}

            {resource.compose && resource.compose.include && (
                <>
                    <Typography variant="h4">Include</Typography>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>valueSet</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.compose.include.map((include, index) => (
                                    <TableRow key={index}>
                                        <TableCell>{include.valueSet}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}
        </>
    );
}

export default ValueSet;
