import React from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';
import Coding from '../partials/Coding';

const AuditEvent = ({resource}) => {

    return (
        <div>
            <Coding resourceType={resource.resourceType} codings={resource.type} name="Type" searchParameter='type'/>
            <Coding resourceType={resource.resourceType} codings={resource.subtype} name="SubType" searchParameter='subtype'/>

            <Typography variant="h4">Recorded</Typography>
            <Typography variant="body1">{resource.recorded}</Typography>

            {resource.agent && (
                <>
                    <Typography variant="h4">Agents</Typography>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Type</TableCell>
                                    <TableCell>Role</TableCell>
                                    <TableCell>Who</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.agent.map((agent) => (
                                    <TableRow key={agent.id}>
                                        <TableCell>{agent.type?.coding?.[0]?.code || ''}</TableCell>
                                        <TableCell>{agent.role?.[0]?.coding?.[0]?.code || ''}</TableCell>
                                        <TableCell>
                                            {agent.who && (
                                                <a href={`/4_0_0/${agent.who.reference}`}>
                                                    {agent.who.display || agent.who.reference}
                                                </a>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}

            {resource.source && (
                <>
                    <Typography variant="h4">Source</Typography>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Site</TableCell>
                                    <TableCell>Observer</TableCell>
                                    <TableCell>Type System</TableCell>
                                    <TableCell>Type Code</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                <TableRow>
                                    <TableCell>{resource.source.site}</TableCell>
                                    <TableCell>{resource.source?.observer?.reference}</TableCell>
                                    <TableCell>{resource.source?.type?.[0]?.system}</TableCell>
                                    <TableCell>{resource.source?.type?.[0]?.code}</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}
            {resource.entity && (
                <>
                    <Typography variant="h4">Entity</Typography>
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Type</TableCell>
                                    <TableCell>Value</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.entity.map((entity) => (
                                    <>
                                        {entity.what?.reference && (
                                            <TableRow>
                                                <TableCell>Reference</TableCell>
                                                <TableCell>{entity.what.reference}</TableCell>
                                            </TableRow>
                                        )}
                                        {entity.detail && entity.detail.map((detail) => (
                                            <TableRow>
                                                <TableCell>{detail.type}</TableCell>
                                                <TableCell>{detail.valueString}</TableCell>
                                            </TableRow>
                                        ))}
                                    </>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}

        </div>
    );
};

export default AuditEvent;
