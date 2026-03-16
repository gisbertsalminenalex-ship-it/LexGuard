// netlify/functions/generator.js
// Proxy para generar documentos legales con IA

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://lexguard.netlify.app';
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';
const MODEL          = 'claude-sonnet-4-20250514';

const { checkRateLimit, getClientIP } = require('./_rateLimit');
const RATE_MAX = 15;
const RATE_WIN = 60_000;

const DOC_NAMES = {
  privacidad:   'Política de Privacidad (RGPD art. 13)',
  cookies:      'Política de Cookies (LSSI + Directiva ePrivacy)',
  devoluciones: 'Política de Devoluciones y Desistimiento (Directiva 2011/83/UE)',
  aviso:        'Aviso Legal (LSSI-CE art. 10)',
  condiciones:  'Términos y Condiciones de Compraventa',
  dsa:          'Política de Cumplimiento DSA (Reglamento UE 2022/2065)',
};

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

  const { docType, bizName, country, products, isPro } = body;

  if (!docType || !DOC_NAMES[docType]) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Tipo de documento inválido.' }) };
  }

  const docName = DOC_NAMES[docType];
  const maxTokens = isPro ? 1500 : 1000;

  const prompt = `Eres un abogado especialista en comercio electrónico europeo. Redacta un documento completo de "${docName}" para:

- Empresa/tienda: ${bizName || 'Mi Tienda'}
- País de establecimiento: ${country || 'España'}
- Tipo de productos: ${products || 'productos varios'}

Requisitos:
- Escrito en español profesional y claro
- Cumple estrictamente con la normativa europea y española vigente en 2026
- Incluye TODAS las secciones y cláusulas obligatorias
- Menciona los artículos legales específicos aplicables
- Listo para publicar directamente en la web
- Usa secciones numeradas con títulos en mayúsculas

Empieza directamente con el título del documento en mayúsculas. No incluyas ningún preámbulo ni explicación.`;

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
        max_tokens: maxTokens,
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
