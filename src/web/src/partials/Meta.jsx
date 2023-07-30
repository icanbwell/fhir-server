import React from 'react';

function Meta({ meta, resource }) {
  if (!meta) return null;

  const formatDate = (date) => new Date(date).toISOString();

  return (
    <div>
      <h4>Meta</h4>
      {meta.lastUpdated && (
        <div>
          <b>Last Updated:</b> {meta.lastUpdated}
          <a
            title={`Get ${resource.resourceType} resources on this date`}
            href={`/4_0_0/${resource.resourceType}?_lastUpdated=${formatDate(meta.lastUpdated).substring(0, 10)}`}
          >
            [On This Date]
          </a>
          <a
            title={`Get ${resource.resourceType} resources before this date`}
            href={`/4_0_0/${resource.resourceType}?_lastUpdated=lt${formatDate(meta.lastUpdated).split('.')[0]+'Z'}`}
          >
            [Before This]
          </a>
          <a
            title={`Get ${resource.resourceType} resources after this date`}
            href={`/4_0_0/${resource.resourceType}?_lastUpdated=gt${formatDate(meta.lastUpdated).split('.')[0]+'Z'}`}
          >
            [After This]
          </a>
        </div>
      )}
      <div>
        <b>Version:</b> {meta.versionId}
        <a
          title="Show history for this resource"
          href={`/4_0_0/${resource.resourceType}/${resource.id}/_history`}
        >
          [History]
        </a>
      </div>
      <div>
        <b>Source:</b>
        <a
          title={`Filter ${resource.resourceType} by ${meta.source}`}
          href={`/4_0_0/${resource.resourceType}?source=${meta.source}`}
        >
          {meta.source}
        </a>
      </div>
      <h5>Security</h5>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Code</th>
            <th scope="col">System</th>
          </tr>
        </thead>
        <tbody>
          {meta.security && meta.security.map((security) => (
            <tr key={security.id}>
              <td>{security.id}</td>
              <td>
                <a
                  title={`Filter ${resource.resourceType} by ${security.code}`}
                  href={`/4_0_0/${resource.resourceType}?_security=${security.system}|${security.code}`}
                >
                  {security.code}
                </a>
              </td>
              <td>{security.system}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Meta;
