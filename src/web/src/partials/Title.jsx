import React from 'react';

class Title extends React.Component {
    render() {
        const {resourceDefinition, resources} = this.props; // Props should contain the needed data
        let title;

        if (resourceDefinition) {
            if (resources && resources.length === 1 && resources[0].id) {
                title = `${resourceDefinition.name} ${resources[0].id}`;
            } else {
                title = `${resourceDefinition.name} Search`;
            }
        } else {
            title = 'Helix FHIR Server';
        }

        document.title = title; // This changes the title of the document

        return null; // This component doesn't render anything
    }
}

export default Title;
