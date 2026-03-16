// netlify/functions/audit.js
// Proxy seguro para auditorías de compliance — la API key nunca llega al navegador.
//
// Variables de entorno en Netlify Dashboard:
//   ANTHROPIC_API_KEY = sk-ant-xxxxxxxx
//   ALLOWED_ORIGIN    = https://tu-dominio.netlify.app

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://lexguard.netlify.app';
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';
const MODEL          = 'claude-sonnet-4-20250514';

const { checkRateLimit, getClientIP } = require('./_rateLimit');
const RATE_MAX = 10;
const RATE_WIN = 60_000;

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };

  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Servicio no disponible.' }) };

  const ip = getClientIP(event.headers);
  const { limited, retryAfterSec } = checkRateLimit(ip, RATE_MAX, RATE_WIN);
  if (limited) {
    return { statusCode: 429, headers: { ...corsHeaders, 'Retry-After': String(retryAfterSec) },
      body: JSON.stringify({ error: 'Demasiadas peticiones. Espera un momento.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Petición inválida.' }) }; }

  const { url } = body;
  if (!url || url.length < 4) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'URL inválida.' }) };
  }

  const prompt = `Eres un experto legal en comercio electrónico europeo (RGPD, LSSI, DSA, Directiva 2011/83/UE, Directiva Omnibus).

Simula una auditoría de compliance para el ecommerce: ${url}

Devuelve SOLO JSON válido con esta estructura:
{
  "issues": [
    {"level": "critical"|"warning"|"ok", "title": "...", "desc": "...", "icon": "emoji"},
    ...
  ]
}

Incluye exactamente 8 issues sobre: política de privacidad RGPD, banner de cookies LSSI/ePrivacy, aviso legal, política de devoluciones Directiva 2011/83/UE, DSA, precios Directiva Omnibus, facturación electrónica, y seguridad básica.

Mezcla niveles: 2-3 critical, 3 warning, 2-3 ok. Los títulos deben ser concretos y en español. Las descripciones deben incluir el artículo legal específico infringido y el riesgo de multa cuando aplique. No inventes datos reales de la tienda.`;

  let apiRes;
  try {
    apiRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    console.error('[audit] fetch error:', err);
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Error conectando con la IA.' }) };
  }

  if (!apiRes.ok) {
    console.error('[audit] API error:', apiRes.status);
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Error en el servicio de IA.' }) };
  }

  const data = await apiRes.json();
  let raw = (data.content?.[0]?.text || '').trim().replace(/```json|```/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Respuesta de IA inválida.' }) }; }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
  };
};
