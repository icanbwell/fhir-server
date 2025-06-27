| Status Code | Description                                            |
|-------------|--------------------------------------------------------|
| 200         | You should receive the expected response as per the request.                   |
| 201         | Resource is created.                                   |
| 400         | Post request with invalid data is sent. Response body contains issues present in the request data. |
| 401         | Unauthorized Access.                                   |
| 403         | Your token does not have access to this FHIR resource. |
| 413         | Request body size is larger than the limit defined by env variable PAYLOAD_LIMIT (default 50mb) |
| 404         | The URL you are trying to access doesn't exist.           |
| 409         | You are not allowed to perform the following operation.              |
| 500         | There is an issue with the server's code. Please report the problem.            |
| 504         | Request is taking too long to complete. Send the request again, and if the problem persists, please report the issue. |
