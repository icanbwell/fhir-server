import React, {useState} from 'react';

function PatientChatGptPage() {
    const [
        textInput,
        setTextInput, textResponse,
        setTextResponse
    ] = useState('');

    const handleInputChange = (event) => {
        setTextInput(event.target.value);
    };

    const callApi = () => {
        const urlEncodedQuestion = encodeURIComponent(textInput);
        fetch(`/4_0_0/Patient/john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3/$everything?_question=${urlEncodedQuestion}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
        })
            .then(response => response.json())
            .then(data => {
                // Process the API response
                console.log(data);
                if (data.entry && data.entry.length > 0) {
                    const patient = data.entry[0].resource;
                    if (patient && patient.text && patient.text.div) {
                        // setTextResponse(patient.text.div);
                    }
                }
            })
            .catch(error => {
                console.error(error);
            });
    };

    return (
        <div>
            <input type="text" value={textInput} onChange={handleInputChange}
                   defaultValue="What is the age of this patient?"/>
            <button onClick={callApi}>Ask</button>
            {textResponse && (
                <div>
                    <h2>Received Data:</h2>
                    <pre>{JSON.stringify(textResponse, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}

export default PatientChatGptPage;

