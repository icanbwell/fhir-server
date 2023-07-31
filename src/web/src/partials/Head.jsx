import React from 'react';
import Title from '../partials/Title';

class Header extends React.Component {
  render() {
    return (
      <React.Fragment>
        <meta charSet="UTF-8"/>
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate"/>
        <meta httpEquiv="Pragma" content="no-cache"/>
        <meta httpEquiv="Expires" content="0"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <Title />
      </React.Fragment>
    );
  }
}

export default Header;
