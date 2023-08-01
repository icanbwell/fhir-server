import React from 'react';
import {makeStyles} from '@mui/styles';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

const useStyles = makeStyles({
    table: {
    },
});

function Meta({meta, resource}) {
    const classes = useStyles();
    if (!meta) {
        return null;
    }

    const formatDate = (date) => new Date(date).toISOString();

    return (
        <div>
            <h4>Meta</h4>
            {meta.lastUpdated && (
                <div>
                    <b>Last Updated:</b> {meta.lastUpdated}
                    <a
                        title={`Get ${resource.resourceType} resources on this date`}
                        href={`/4_0_0/${resource.resourceType}?_lastUpdated=${formatDate(meta.lastUpdated).substring(0, 10)}`}
                    >
                        [On This Date]
                    </a>
                    <a
                        title={`Get ${resource.resourceType} resources before this date`}
                        href={`/4_0_0/${resource.resourceType}?_lastUpdated=lt${formatDate(meta.lastUpdated).split('.')[0] + 'Z'}`}
                    >
                        [Before This]
                    </a>
                    <a
                        title={`Get ${resource.resourceType} resources after this date`}
                        href={`/4_0_0/${resource.resourceType}?_lastUpdated=gt${formatDate(meta.lastUpdated).split('.')[0] + 'Z'}`}
                    >
                        [After This]
                    </a>
                </div>
            )}
            <div>
                <b>Version:</b> {meta.versionId}
                <a
                    title="Show history for this resource"
                    href={`/4_0_0/${resource.resourceType}/${resource.id}/_history`}
                >
                    [History]
                </a>
            </div>
            <div>
                <b>Source:</b>
                <a
                    title={`Filter ${resource.resourceType} by ${meta.source}`}
                    href={`/4_0_0/${resource.resourceType}?source=${meta.source}`}
                >
                    {meta.source}
                </a>
            </div>
            <h5>Security</h5>
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
                                    <a
                                        title={`Filter ${resource.resourceType} by ${security.code}`}
                                        href={`/4_0_0/${resource.resourceType}?_security=${security.system}|${security.code}`}
                                    >
                                        {security.code}
                                    </a>
                                </TableCell>
                                <TableCell>{security.system}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </div>
    );
}

export default Meta;
