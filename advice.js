// netlify/functions/advice.js
// Genera guías de adaptación a cambios normativos

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://lexguard.netlify.app';
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';
const MODEL          = 'claude-sonnet-4-20250514';

const { checkRateLimit, getClientIP } = require('./_rateLimit');
const RATE_MAX = 20;
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
      body: JSON.stringify({ error: 'Demasiadas peticiones.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Petición inválida.' }) }; }

  const { topic, title } = body;
  if (!topic) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Tema requerido.' }) };

  const prompt = `Eres un experto en normativa de comercio electrónico europeo. Una tienda online española necesita saber cómo adaptarse a: "${title}".

Proporciona una guía práctica y concisa que incluya:
1. Qué ha cambiado exactamente (máximo 2 frases)
2. Checklist de acciones concretas (4-6 puntos)
3. Plazo para adaptarse
4. Consecuencias de no cumplir (multas específicas si las hay)

Sin jerga legal innecesaria. Práctico y directo. En español.`;

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
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Error conectando con la IA.' }) };
  }

  if (!apiRes.ok) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Error en el servicio de IA.' }) };
  }

  const data = await apiRes.json();
  const text = (data.content?.[0]?.text || '').trim();

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  };
};
