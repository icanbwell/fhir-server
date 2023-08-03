import React from 'react';

const Narrative = ({ value, name }) => {
    if (value !== undefined && value.div !== undefined) {
        return (
            <div>
                <h4>{name}</h4>&nbsp;
                <div dangerouslySetInnerHTML={{ __html: value.div }} />
            </div>
        );
    } else {
        return null;
    }
}

export default Narrative;
