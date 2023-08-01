import React from 'react';
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from '@mui/material';

const Annotation = ({annotations}) => {

    // Check if annotations is not an array and convert it to an array
    let normalizedAnnotations = Array.isArray(annotations) ? annotations : [annotations];

    // Filter out any null or undefined annotations
    normalizedAnnotations = normalizedAnnotations.filter(annotation => !!annotation);

    if (normalizedAnnotations.length === 0) {
        return null;
    }

    return (
        <div>
            <Typography variant="h4">Names</Typography>
            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Author</TableCell>
                            <TableCell>Time</TableCell>
                            <TableCell>Text</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {normalizedAnnotations.map((annotation, index) => (
                            <TableRow key={index}>
                                <TableCell>{annotation.authorReference ? annotation.authorReference.reference : annotation.authorString}</TableCell>
                                <TableCell>{annotation.time}</TableCell>
                                <TableCell>{annotation.text}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </div>
    );
};

export default Annotation;
