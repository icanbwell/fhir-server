# Streaming

## Summary
This FHIR Server supports streaming data.

## Benefits for Clients
1. Clients can get data streamed using just one connection.
2. Uses HTTP Keep-alive so reduces the network overhead for each call.
3. Client starts receiving data quickly so can start to process the data while waiting for more data to come.

## Benefits for Server
1. Less memory usage in the FHIR server. The FHIR server does not need to load the whole result set in memory before sending to client. Now it can just load a chunk from Mongo, send to client and then load the next chunk.
2. The cursor is maintained for the whole request so avoids Mongo having to do the search again for the next page

## HTTP Chunk Transfer 
FHIR Server streaming uses HTTP Chunk Transfer to send the data:
https://www.oracle.com/technical-resources/articles/javame/chunking.html


## Client Implementation
1. Client opens a connection and sends a request as in the non-streaming case.  
2. Server sends the data in chunks.  Client processes the chunk and waits for the next one.


Clients can use the chunk transfer mechanism in their client requests library.
For example,
https://2.python-requests.org/projects/3/user/advanced/#chunk-encoded-requests

```python
async with ClientSession(timeout=ClientTimeout(total=0)) as http:
    async with http.request("GET", fhir_server_url, headers=headers, data=payload, ssl=False) as response:
        async for line in response.content:
            print(f"{line }", end='\r')
```

You can see an example at: https://github.com/icanbwell/fhir-server-performance/blob/main/simple.py

### NDJson Format
Streaming is available for both the standard FHIR JSON format and for the NDJSON format.  

NDJSON (http://ndjson.org/) is an optimized format for streaming since each resource is on a separate line.  
NDJson is also a supported format of FHIR Bulk API: http://hl7.org/fhir/uv/bulkdata/2021May/export.html.


To request the NDJSON format, the client passes in the appropriate Accept header:
```html
Accept: application/fhir+ndjson
```


