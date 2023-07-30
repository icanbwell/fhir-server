import React from 'react';

function Identifier({ identifiers, name, resourceType }) {
    if (!Array.isArray(identifiers)) {
        identifiers = [identifiers];
    }

    if (identifiers && identifiers.length > 0 && identifiers[0]) {
        return (
            <div>
                <h4>{name}</h4>
                <table className="table">
                    <thead>
                        <tr>
                            <th scope="col">Id</th>
                            <th scope="col">Value</th>
                            <th scope="col">System</th>
                            <th scope="col">Type Code</th>
                            <th scope="col">Type System</th>
                        </tr>
                    </thead>
                    <tbody>
                        {identifiers.map(identifier => {
                            if (identifier) {
                                return (
                                    <tr key={identifier.id}>
                                        <td>{identifier.id}</td>
                                        <td>
                                            <a title={`Search for ${identifier.value}`}
                                               href={`/4_0_0/${resourceType}?identifier=${identifier.system}|${identifier.value}`}>{identifier.value}</a>
                                        </td>
                                        <td>{identifier.system}</td>
                                        <td>
                                            {identifier.type && identifier.type.coding &&
                                                identifier.type.coding.map(coding => <span key={coding.code}>{coding.code} &nbsp;</span>)
                                            }
                                        </td>
                                        <td>
                                            {identifier.type && identifier.type.coding &&
                                                identifier.type.coding.map(coding => <span key={coding.system}>{coding.system} &nbsp;</span>)
                                            }
                                        </td>
                                    </tr>
                                );
                            }
                            return null;
                        })}
                    </tbody>
                </table>
            </div>
        );
    }
    return null;
}

export default Identifier;
