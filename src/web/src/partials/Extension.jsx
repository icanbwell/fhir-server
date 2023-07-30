import React from 'react';

class Extension extends React.Component {
    render() {
        let { extensions } = this.props;

        if (!Array.isArray(extensions)) {
            extensions = [extensions];
        }

        if (!extensions || extensions.length === 0 || !extensions[0]) {
            return null;
        }

        return (
            <>
                <h4>Extension</h4>
                <table className="table">
                    <thead>
                        <tr>
                          <th scope="col">Id</th>
                          <th scope="col">Url</th>
                          <th scope="col">Detail Url</th>
                          <th scope="col">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                    {extensions.map(extension => {
                        if (extension && extension.extension) {
                            return extension.extension.map(detailExtension => {
                                if (detailExtension) {
                                    return (
                                        <tr key={detailExtension.url}>
                                            <td>{extension.id}</td>
                                            <td>{extension.url}</td>
                                            <td>{detailExtension.url}</td>
                                            <td>
                                                {detailExtension.valueCodeableConcept ?
                                                    `${detailExtension.valueCodeableConcept.coding[0].code} (${detailExtension.valueCodeableConcept.text})`
                                                    : detailExtension.valueRange ?
                                                        `${detailExtension.valueRange.low.value} ${detailExtension.valueRange.low.unit} to ${detailExtension.valueRange.high.value} ${detailExtension.valueRange.high.unit}`
                                                        :
                                                        `${detailExtension.valueString}${detailExtension.valueUri}`
                                                }
                                            </td>
                                        </tr>
                                    )
                                }
                                return null;
                            });
                        } else if (extension) {
                            return (
                                <tr key={extension.id}>
                                    <td>{extension.id}</td>
                                    <td>{extension.url}</td>
                                    <td></td>
                                    <td>
                                        {extension.valueCodeableConcept ?
                                            `${extension.valueCodeableConcept.coding[0].code} (${extension.valueCodeableConcept.text})`
                                            :
                                            `${extension.valueString}${extension.valueUri}`
                                        }
                                    </td>
                                </tr>
                            );
                        }
                        return null;
                    })}
                    </tbody>
                </table>
            </>
        );
    }
}

export default Extension;
