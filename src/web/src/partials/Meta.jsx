import React from 'react';
import {makeStyles} from '@mui/styles';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import {Box, Link, Typography} from '@mui/material';

const useStyles = makeStyles({
    table: {},
});

function Meta({meta, resource}) {
    const classes = useStyles();
    if (!meta) {
        return null;
    }

    const formatDate = (date) => new Date(date).toISOString();

    return (
        <Box>
            <Typography variant="h4">Meta</Typography>
            {meta.lastUpdated && (
                <Box>
                    <Typography variant="body1">
                        <b>Last Updated:</b> {meta.lastUpdated}
                        <Link
                            title={`Get ${resource.resourceType} resources on this date`}
                            href={`/4_0_0/${resource.resourceType}?_lastUpdated=${formatDate(meta.lastUpdated).substring(0, 10)}`}
                        >
                            [On This Date]
                        </Link>
                        <Link
                            title={`Get ${resource.resourceType} resources before this date`}
                            href={`/4_0_0/${resource.resourceType}?_lastUpdated=lt${formatDate(meta.lastUpdated).split('.')[0] + 'Z'}`}
                        >
                            [Before This]
                        </Link>
                        <Link
                            title={`Get ${resource.resourceType} resources after this date`}
                            href={`/4_0_0/${resource.resourceType}?_lastUpdated=gt${formatDate(meta.lastUpdated).split('.')[0] + 'Z'}`}
                        >
                            [After This]
                        </Link>
                    </Typography>
                </Box>
            )}
            <Box>
                <Typography variant="body1">
                    <b>Version:</b> {meta.versionId}
                    <Link
                        title="Show history for this resource"
                        href={`/4_0_0/${resource.resourceType}/${resource.id}/_history`}
                    >
                        [History]
                    </Link>
                </Typography>
            </Box>
            <Box>
                <Typography variant="body1">
                    <b>Source:</b>
                    <Link
                        title={`Filter ${resource.resourceType} by ${meta.source}`}
                        href={`/4_0_0/${resource.resourceType}?source=${meta.source}`}
                    >
                        {meta.source}
                    </Link>
                </Typography>
            </Box>
            <Typography variant="h5">Security</Typography>
            <TableContainer>
                <Table className={classes.table} aria-label="security table">
                    <TableHead>
                        <TableRow>
                            <TableCell>Id</TableCell>
                            <TableCell>Code</TableCell>
                            <TableCell>System</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {meta.security && meta.security.map((security) => (
                            <TableRow key={security.id}>
                                <TableCell>{security.id}</TableCell>
                                <TableCell>
                                    <Link
                                        title={`Filter ${resource.resourceType} by ${security.code}`}
                                        href={`/4_0_0/${resource.resourceType}?_security=${security.system}|${security.code}`}
                                    >
                                        {security.code}
                                    </Link>
                                </TableCell>
                                <TableCell>{security.system}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
}

export default Meta;
