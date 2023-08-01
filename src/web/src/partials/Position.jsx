import React from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

function Position({positions, name}) {
    // Ensure positions is an array
    if (!Array.isArray(positions)) {
        positions = [positions];
    }

    if (positions && positions.length > 0 && positions[0]) {
        return (
            <div>
                <Typography variant="h4">{name}</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Latitude</TableCell>
                                <TableCell>Longitude</TableCell>
                                <TableCell>Map</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {positions.map((position, index) => {
                                if (position) {
                                    return (
                                        <TableRow key={index}>
                                            <TableCell>{position.latitude}</TableCell>
                                            <TableCell>{position.longitude}</TableCell>
                                            <TableCell>
                                                <a
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    href={`https://www.google.com/maps/search/?api=1&query=${position.latitude}%2C${position.longitude}`}
                                                >
                                                    Map
                                                </a>
                                            </TableCell>
                                        </TableRow>
                                    );
                                } else {
                                    return null;
                                }
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
        );
    } else {
        return null;
    }
}

export default Position;
