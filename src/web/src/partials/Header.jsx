import React from 'react';
import {AppBar, Toolbar, Typography, IconButton, Button} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import LogoutIcon from '@mui/icons-material/Logout';
import HomeIcon from '@mui/icons-material/Home';
import {Link} from 'react-router-dom';

class Header extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            deployEnvironment: 'Your Deploy Environment',
            environment: 'Your Environment',
            resources: [],
        };
    }

    render() {
        const {deployEnvironment, environment, resources} = this.state;
        return (
            <AppBar position="static">
                <Toolbar>
                    <IconButton color="inherit" aria-label="home" id="home" component={Link} to="/">
                        <HomeIcon/>
                    </IconButton>

                    <Typography variant="h6" style={{flexGrow: 1}}>
                        Helix FHIR Server
                    </Typography>
                    <IconButton color="inherit" aria-label="information" id="appInfo">
                        <InfoIcon/>
                    </IconButton>
                    {environment &&
                        <Button color="inherit" startIcon={<LogoutIcon/>} id="btnLogout" href="/logout_action">
                            Logout
                        </Button>
                    }
                </Toolbar>
            </AppBar>
        );
    }
}

export default Header;
