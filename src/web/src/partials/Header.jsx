import React from 'react';
import {AppBar, Toolbar, Typography, IconButton, Button, Box, Alert} from '@mui/material';
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

    setCookie(name, value, days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = "expires=" + date.toUTCString();
        document.cookie = name + "=" + value + ";" + expires + ";path=/";
    }

    getCookie(name) {
        const cookieName = name + "=";
        const decodedCookie = decodeURIComponent(document.cookie);
        const cookies = decodedCookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i];
            while (cookie.charAt(0) === ' ') {
                cookie = cookie.substring(1);
            }
            if (cookie.indexOf(cookieName) === 0) {
                return cookie.substring(cookieName.length, cookie.length);
            }
        }
        return "";
    }

    deleteCookie(name) {
        console.log(`deleteCookie(${name})`);
        document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    }

    switchToOldUI = () => {
        this.deleteCookie("web2");
        window.location.reload();
    };


    render() {
        const {deployEnvironment, environment, resources} = this.state;
        return (
            <React.Fragment>
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
                <Alert severity="info" action={
                    <Button color="inherit" size="small" onClick={this.switchToOldUI}>
                        Switch to Old UI
                    </Button>
                }>You are using the new UI</Alert>
            </React.Fragment>
        );
    }
}

export default Header;
