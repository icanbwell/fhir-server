import React from 'react';
import Narrative from '../partials/Narrative';
import Identifier from '../partials/Identifier';
import Meta from '../partials/Meta';
import Extension from '../partials/Extension';

function ResourceHeader({ resource }) {
    if (!resource) return null;
    return (
        <div>
            <a name={resource.id}></a>
            <h3>
                <i className="fa fa-file-text-o"></i>&nbsp;{resource.resourceType}/{resource.id}
            </h3>
            <a title="Direct link to Resource" href={`/4_0_0/${resource.resourceType}/${resource.id}`}>
                {resource.resourceType}/{resource.id}
            </a>

            <Narrative name='Text' value={resource.text} />
            <Identifier resourceType={resource.resourceType} identifiers={resource.identifier} name="Identifier" />
            <Meta meta={resource.meta} name="Meta" resource={resource} />
            <Extension extensions={resource.extension} />
            <Extension extensions={resource.modifierExtension} />
        </div>
    );
}

export default ResourceHeader;
