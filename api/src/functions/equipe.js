const { app } = require('@azure/functions');

app.http('equipe', {
    route: 'equipe/{*rest}', // Captura caminhos dinâmicos com parênteses do Azure [2]
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const storageAccount = process.env.AZURE_STORAGE_ACCOUNT;
        const sasToken = process.env.AZURE_SAS_TOKEN;

        if (!storageAccount || !sasToken) {
            return {
                status: 500,
                body: JSON.stringify({ error: "Configurações de ambiente ausentes no Azure." })
            };
        }

        const urlObj = new URL(request.url);
        const query = urlObj.search;
        const rest = request.params.rest || '';

        // Monta o endpoint do Azure Table de forma limpa e decodificada [2]
        let targetUrl = `https://${storageAccount}.table.core.windows.net/EquipeSPI`;
        if (rest) {
            const decodedRest = decodeURIComponent(rest);
            if (decodedRest.startsWith('(')) {
                targetUrl += decodedRest; // Evita barras extras antes do parênteses
            } else {
                targetUrl += '/' + decodedRest;
            }
        }
        
        targetUrl += query + (query ? '&' : '?') + sasToken.replace(/^\?/, '');

        const method = request.method;
        const headers = {
            'Accept': 'application/json;odata=nometadata',
            'Content-Type': 'application/json',
            'x-ms-version': '2020-04-08',
            'DataServiceVersion': '3.0',
            'MaxDataServiceVersion': '3.0'
        };

        if (method === 'DELETE') {
            headers['If-Match'] = '*';
        }

        const body = method !== 'GET' && method !== 'DELETE' ? await request.text() : undefined;

        try {
            const response = await fetch(targetUrl, { method, headers, body });
            const resText = await response.text();

            return {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
                body: resText
            };
        } catch (err) {
            return {
                status: 500,
                body: JSON.stringify({ error: err.message })
            };
        }
    }
});
