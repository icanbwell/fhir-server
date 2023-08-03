import React from 'react';
import {Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';

const Address = ({addresses, name, resourceType}) => {
    if (!Array.isArray(addresses)) {
        addresses = [addresses];
    }

    return (
        addresses && addresses.length > 0 && addresses[0] ? (
            <Box>
                <Typography variant="h4">{name}</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Id</TableCell>
                                <TableCell>Use</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Line</TableCell>
                                <TableCell>City</TableCell>
                                <TableCell>State</TableCell>
                                <TableCell>PostalCode</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {addresses.map((address) => {
                                return (
                                    address ? (
                                        <TableRow key={address.id}>
                                            <TableCell>{address.id}</TableCell>
                                            <TableCell>{address.use}</TableCell>
                                            <TableCell>{address.type}</TableCell>
                                            <TableCell>{address.line}</TableCell>
                                            <TableCell><a
                                                href={`/4_0_0/${resourceType}?address-city=${address.city}`}>{address.city}</a></TableCell>
                                            <TableCell><a
                                                href={`/4_0_0/${resourceType}?address-state=${address.state}`}>{address.state}</a></TableCell>
                                            <TableCell><a
                                                href={`/4_0_0/${resourceType}?address-postalcode=${address.postalCode}`}>{address.postalCode}</a></TableCell>
                                        </TableRow>
                                    ) : null
                                )
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        ) : null
    );
};

export default Address;
