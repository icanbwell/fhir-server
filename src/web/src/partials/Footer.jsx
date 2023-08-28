import React from 'react';
import Pagination from '@mui/material/Pagination';
import PaginationItem from '@mui/material/PaginationItem';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';

function Footer({searchUtils, body, locals, total, url, user, requestId, oauth_scope, currentYear}) {
    const hasPrev = searchUtils ? searchUtils.hasPrev(body._getpagesoffset) : false;
    const hasNext = searchUtils ? searchUtils.hasNext(locals) : false;
    const totalMessage = searchUtils ? searchUtils.totalMessage(locals, total) : '';

    let userInfo = '';
    if (user) {
        userInfo = (!user || typeof user === 'string') ? user : user.name || user.id;
    }

    return (
        <Box sx={{p: 1, display: 'flex', borderTop: 1}}>
            {url && url.includes('/_search') && (
                <>
                    <Pagination>
                        <PaginationItem disabled={!hasPrev} component="button" id="lnkPrevious">
                            Previous
                        </PaginationItem>
                        <PaginationItem disabled={!hasNext} component="button" id="lnkNext">
                            Next
                        </PaginationItem>
                    </Pagination>
                    <Box sx={{px: 3, pt: 2}}>
                        <Typography variant="body2">{totalMessage}</Typography>
                    </Box>
                </>
            )}
            {user && (
                <Box sx={{flexGrow: 1, pt: 2, textAlign: 'end'}}>
                    <Typography variant="body2">
                        User: {userInfo} | RequestId: {requestId} | Scopes: {oauth_scope}
                    </Typography>
                </Box>
            )}
            <Box sx={{flexGrow: 1, pt: 2, textAlign: 'end'}}>
                <Typography variant="body2">
                    &copy; Copyright {currentYear} b.well Connected Health |&nbsp;&nbsp;
                    <Link
                        href="https://docs.google.com/document/d/1afAuyrckHabnCP-uhOqXOQzFUuA4e6yN/edit?usp=sharing&ouid=100180767885483338723&rtpof=true&sd=true">Conditions
                        of Use</Link>
                </Typography>
            </Box>
        </Box>
    );
}

export default Footer;
