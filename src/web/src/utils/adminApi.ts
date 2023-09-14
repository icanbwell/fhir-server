interface RunPersonMatchParams {
    sourceId: string;
    sourceType: string;
    targetId: string;
    targetType: string;
}

class AdminApi {
    async runPersonMatch({sourceId, sourceType, targetId, targetType}: RunPersonMatchParams): Promise<any> {
        const urlString = '/admin/runPersonMatch';
        const url = new URL(urlString, window.location.origin);
        const params = {
            sourceId,
            sourceType,
            targetId,
            targetType,
        };

        url.search = new URLSearchParams(params).toString();

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data: any = await response.json();
        return data;
    }

    async getEverythingForPatient(patientId: string): Promise<any> {
        const urlString = `/4_0_0/Patient/$everything?id=${patientId}&_format=json&contained=true`;
        const url = new URL(urlString, window.location.origin);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data: any = await response.json();
        return data;
    }

    async deletePatient(patientId: string): Promise<any> {
        const urlString = `/admin/deletePatientDataGraph?id=${patientId}`;
        const url = new URL(urlString, window.location.origin);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data: any = await response.json();
        return data;
    }

    async getEverythingForPerson(personId: string): Promise<any> {
        const urlString = `/4_0_0/Person/$everything?id=${personId}&_format=json&contained=true`;
        const url = new URL(urlString, window.location.origin);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data: any = await response.json();
        return data;
    }

    async deletePerson(personId: string): Promise<any> {
        const urlString = `/admin/deletePersonDataGraph?id=${personId}`;
        const url = new URL(urlString, window.location.origin);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data: any = await response.json();
        return data;
    }

}

export default AdminApi;
