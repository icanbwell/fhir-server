import React from 'react';

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
            <React.Fragment>
                <header>
                    <nav className="navbar px-3 pt-2">
                        <a href="/" title="Go to Home Page" className="px-3 helix-logo"></a>
                        <h5 className="flex-grow-1 px-3 mb-0">Helix FHIR Server - {deployEnvironment}</h5>
                        <button
                            type="button"
                            id="appInfo"
                            className="btn btn-light fa fa-info ms-2"
                            title="Information"
                            data-bs-toggle="modal"
                            data-bs-target="#appInfoModal"
                        ></button>

                        {environment &&
                            <a id="btnLogout" className="btn btn-success btn-sm ms-2" href="/logout_action">
                                <i className="fa fa-sign-out"></i>
                                Logout
                            </a>
                        }
                    </nav>
                </header>
                {resources && resources.length === 0 &&
                    <React.Fragment>
                        <br/>
                        <h2 style={{textAlign: "center"}}>No Resources Found</h2>
                    </React.Fragment>
                }
            </React.Fragment>
        );
    }
}

export default Header;
