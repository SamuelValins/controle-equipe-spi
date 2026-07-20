const { app } = require('@azure/functions');

app.http('equipe', {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // Sanitização ultra-agressiva para limpar espaços, quebras de linha e aspas acidentais das chaves do Azure
        const storageAccount = (process.env.AZURE_STORAGE_ACCOUNT || '')
            .trim()
            .replace(/^["']|["']$/g, '');

        const sasToken = (process.env.AZURE_SAS_TOKEN || '')
            .trim()
            .replace(/^["']|["']$/g, '');

        if (!storageAccount || !sasToken) {
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: "Configurações de ambiente ausentes no Azure." })
            };
        }

        const urlObj = new URL(request.url);
        
        // Lê de forma limpa os parâmetros de consulta enviados pelo navegador
        const pk = urlObj.searchParams.get('PartitionKey');
        const rk = urlObj.searchParams.get('RowKey');

        // Reconstrói a URL de forma precisa para a tabela "EquipeSPI" no Azure [2]
        let targetUrl = `https://${storageAccount}.table.core.windows.net/EquipeSPI`;
        if (pk && rk) {
            targetUrl += `(PartitionKey='${pk}',RowKey='${rk}')`;
            
            // Remove do Query String para não enviar duplicado para o Azure
            urlObj.searchParams.delete('PartitionKey');
            urlObj.searchParams.delete('RowKey');
        }

        const query = urlObj.search;
        const cleanSas = sasToken.startsWith('?') ? sasToken : '?' + sasToken;
        if (query) {
            targetUrl += query + '&' + cleanSas.substring(1);
        } else {
            targetUrl += cleanSas;
        }

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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    error: err.message, 
                    causa: err.cause ? err.cause.message : 'DNS ou Conexão Recusada',
                    urlConsultada: targetUrl.split('?')[0] + '?[SAS_OCULTADO]',
                    inicioToken: sasToken.substring(0, 15) + "..."
                })
            };
        }
    }
});
