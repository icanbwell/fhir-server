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
}

export default AdminApi;
