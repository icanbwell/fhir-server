import React from 'react';
import {Typography, Button, Container, Box} from '@mui/material';

interface PersonMatchPageProps {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
}

const PersonMatchPage: React.FC = ({sourceType, sourceId, targetType, targetId}: PersonMatchPageProps) => {
    return (
        <Container maxWidth="sm">
            <Box my={4}>
                <Typography variant="h4" component="h1" gutterBottom>
                    Welcome to the Sample Page!
                </Typography>
                <Typography variant="body1" component="p" gutterBottom>
                    This is a simple page made using Material-UI components in a React TypeScript project.
                </Typography>
                <Button variant="contained" color="primary">
                    Click Me!
                </Button>
            </Box>
        </Container>
    );
};

export default PersonMatchPage;
