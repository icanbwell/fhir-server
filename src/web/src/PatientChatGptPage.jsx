import React, {useState} from 'react';

function PatientChatGptPage() {
    const [
        textInput,
        setTextInput,
        textResponse,
        setTextResponse,
        data,
        setData
    ] = useState('');

    const handleInputChange = (event) => {
        setTextInput(event.target.value);
    };

    const callApi = async () => {
        try {
            const urlEncodedQuestion = encodeURIComponent(textInput);
            const patientId = `john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3`;
            const url = `/4_0_0/Patient/${patientId}/$everything?_question=${urlEncodedQuestion}`;
            const response = await fetch(url,
                {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                });
            const data = await response.json();
            console.log(data);
            // setData(data);
            // if (data.entry && data.entry.length > 0) {
            //     const patient = data.entry[0].resource;
            //     if (patient && patient.text && patient.text.div) {
            //         console.log(patient.text.div);
            //         // setTextResponse(patient.text.div);
            //     }
            // }
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div>
            <input type="text" value={textInput} onChange={handleInputChange}
                   defaultValue="What is the age of this patient?"/>
            <button onClick={callApi}>Ask</button>
            {data ? (
                <div>
                    <h2>API Response:</h2>
                    <pre>{JSON.stringify(data, null, 2)}</pre>
                </div>
            ) : (
                <p>Loading...</p>
            )}
        </div>
    );
}

export default PatientChatGptPage;

