const { app } = require('@azure/functions');
const https = require('https');

// Função auxiliar para realizar requisições HTTPS nativas (evita quebras devido à ausência do global fetch em ambientes legados)
function makeRequest(targetUrl, method, headers, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(targetUrl, { method, headers }, (res) => {
            let resText = '';
            res.on('data', (chunk) => {
                resText += chunk;
            });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: resText
                });
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        if (body !== undefined) {
            req.write(body);
        }
        req.end();
    });
}

app.http('equipe', {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // Sanitização para limpar espaços, quebras de linha e aspas acidentais das chaves do Azure
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

            // Reconstrói a URL de forma precisa para a tabela "EquipeSPI" no Azure
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

            // Injeção automática de PartitionKey e RowKey no corpo se for PUT/POST
            let body = undefined;
            if (method !== 'GET' && method !== 'DELETE') {
                const rawBody = await request.text();
                if (rawBody) {
                    try {
                        const jsonBody = JSON.parse(rawBody);
                        if (pk && !jsonBody.PartitionKey) {
                            jsonBody.PartitionKey = pk;
                        }
                        if (rk && !jsonBody.RowKey) {
                            jsonBody.RowKey = rk;
                        }
                        body = JSON.stringify(jsonBody);
                    } catch (e) {
                        body = rawBody; // Fallback caso não seja JSON válido
                    }
                }
            }

            const response = await makeRequest(targetUrl, method, headers, body);

            return {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
                body: response.body
            };

        } catch (err) {
            context.log("Erro interno na execução da API:", err);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    error: err.message || String(err), 
                    causa: "Erro interno no backend (Proxy equipe.js)"
                })
            };
        }
    }
});
