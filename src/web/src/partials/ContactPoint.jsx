import React from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from '@mui/material';

function ContactPoint({contacts, name, resourceType}) {

    // Ensuring contacts is an array
    if (!Array.isArray(contacts)) {
        contacts = [contacts];
    }

    // Render null if there are no valid contacts
    if (!contacts || contacts.length === 0 || !contacts[0]) {
        return null;
    }

    return (
        <div>
            <h4>{name}</h4>
            <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Id</TableCell>
                            <TableCell>System</TableCell>
                            <TableCell>Value</TableCell>
                            <TableCell>Use</TableCell>
                            <TableCell>Rank</TableCell>
                            <TableCell>Period</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {contacts.map((contact, index) => (
                            contact && (
                                <TableRow key={index}>
                                    <TableCell>{contact.id}</TableCell>
                                    <TableCell>{contact.system}</TableCell>
                                    <TableCell>
                                        {
                                            contact.system === "email" ?
                                                <a href={`/4_0_0/${resourceType}?email=${contact.value}`}>{contact.value}</a> :
                                                contact.system === "phone" ?
                                                    <a href={`/4_0_0/${resourceType}?phone=${contact.value}`}>{contact.value}</a> :
                                                    contact.value
                                        }
                                    </TableCell>
                                    <TableCell>{contact.use}</TableCell>
                                    <TableCell>{contact.rank}</TableCell>
                                    <TableCell>{contact.period}</TableCell>
                                </TableRow>
                            )
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </div>
    );
}

export default ContactPoint;
