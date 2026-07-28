/**
 * Manny's Hot Wheels — eBay pricing backend
 *
 * Why this exists: eBay's Browse API requires an OAuth client secret.
 * That secret can NEVER live in the static app's JavaScript (anyone can
 * view-source a GitHub Pages site and read it). This tiny serverless
 * function holds the secret, talks to eBay on the app's behalf, and
 * returns plain JSON with CORS headers so the static app can call it.
 *
 * Deploy: Cloudflare Workers free tier (100,000 requests/day, no card
 * required). See ../README.md for the exact click-by-click steps.
 *
 * Required secrets (set in the Worker's dashboard, never in this file):
 *   EBAY_CLIENT_ID
 *   EBAY_CLIENT_SECRET
 * Optional:
 *   EBAY_MARKETPLACE   (default: EBAY_US)
 *   ALLOWED_ORIGIN      (default: * — set this to your github.io origin
 *                        once deployed, to stop other sites from riding
 *                        on your free eBay quota)
 */

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

// In-memory token cache — persists for the life of the Worker instance,
// which avoids re-authenticating on every single request.
let cachedToken = null; // { value, expiresAt }

async function getAppToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const creds = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${creds}`
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });
  if (!res.ok) {
    throw new Error(`eBay token request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}

// Best-effort filter: drop multi-item lots/bundles by title keyword.
// eBay's API doesn't expose a clean "single item only" filter, so this
// is a heuristic, not a guarantee.
const LOT_PATTERN = /\blot of\b|\bbundle\b|\bset of \d|\bwholesale\b|\bjob lot\b/i;

export default {
  async fetch(request, env) {
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);

    if (url.pathname === "/shop-search") {
      return handleShopSearch(url, env, headers);
    }

    if (url.pathname === "/identify") {
      return handleIdentify(request, env, headers);
    }

    if (url.pathname !== "/ebay-search") {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    const q = (url.searchParams.get("q") || "").trim();
    if (!q) {
      return new Response(JSON.stringify({ error: "missing_query" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    try {
      const token = await getAppToken(env);

      // buyingOptions:FIXED_PRICE only — this excludes ALL auctions
      // (including zero-bid ones) by construction, and matches the
      // "prefer Buy It Now" requirement without needing to inspect
      // individual listings for bid counts.
      const params = new URLSearchParams({
        q,
        limit: "15",
        filter: "buyingOptions:{FIXED_PRICE}",
        sort: "price"
      });

      const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": env.EBAY_MARKETPLACE || "EBAY_US"
        }
      });

      if (!res.ok) {
        const detail = await res.text();
        return new Response(JSON.stringify({ error: "ebay_api_error", status: res.status, detail }), {
          status: 502,
          headers: { ...headers, "Content-Type": "application/json" }
        });
      }

      const data = await res.json();
      const results = (data.itemSummaries || [])
        .filter((it) => it.title && !LOT_PATTERN.test(it.title))
        .map((it) => {
          const price = it.price ? Number(it.price.value) : null;
          const shipping =
            it.shippingOptions && it.shippingOptions[0] && it.shippingOptions[0].shippingCost
              ? Number(it.shippingOptions[0].shippingCost.value)
              : 0;
          return {
            marketplace: "eBay",
            title: it.title,
            price,
            shipping,
            totalCost: price != null ? Number((price + shipping).toFixed(2)) : null,
            condition: it.condition || "",
            url: it.itemWebUrl,
            image: it.image ? it.image.imageUrl : null
          };
        })
        .filter((it) => it.price != null)
        .sort((a, b) => a.totalCost - b.totalCost);

      return new Response(JSON.stringify({ results }), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "worker_error", detail: String(err) }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }
  }
};

/**
 * /shop-search — Google Shopping results via SerpApi.
 *
 * Why this exists: eBay and Amazon both submit their own product catalogs
 * to Google Shopping as a marketing channel (Google Merchant Center) — it's
 * how a plain Google search shows prices "from everywhere" without Google
 * having to scrape anyone. SerpApi gives developers a real, ToS-compliant
 * API into that same Google Shopping data. This is the closest legitimate
 * equivalent to "just show me what Google shows."
 *
 * Requires secret: SERPAPI_KEY (free tier: 100 searches/month, no scraping,
 * no ToS violation — SerpApi is Google's data delivered through a paid/free
 * developer API, not an unauthorized scrape).
 */
async function handleShopSearch(url, env, headers) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) {
    return new Response(JSON.stringify({ error: "missing_query" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }
  if (!env.SERPAPI_KEY) {
    return new Response(JSON.stringify({ error: "not_configured", detail: "SERPAPI_KEY secret not set" }), {
      status: 501,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }

  try {
    const params = new URLSearchParams({
      engine: "google_shopping",
      q,
      api_key: env.SERPAPI_KEY,
      hl: "en",
      gl: "us"
    });
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "serpapi_error", status: res.status, detail }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }
    const data = await res.json();
    const results = (data.shopping_results || [])
      .filter((it) => it.title && !LOT_PATTERN.test(it.title) && typeof it.extracted_price === "number")
      .map((it) => ({
        marketplace: it.source || "Google Shopping",
        title: it.title,
        price: it.extracted_price,
        shipping: 0,
        totalCost: it.extracted_price,
        condition: it.condition || "",
        url: it.product_link || it.link || null,
        image: it.thumbnail || null
      }))
      .sort((a, b) => a.totalCost - b.totalCost);

    return new Response(JSON.stringify({ results }), {
      headers: { ...headers, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "worker_error", detail: String(err) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }
}

/**
 * /identify — POST { front: "<base64 jpeg, no data: prefix>", back: "<...>",
 *                     barcode: "..." (optional context) }
 *
 * Why this exists: the barcode often only identifies an assortment/series,
 * not the exact casting — the UPC is frequently shared across an entire
 * wave of different cars. Reading the actual card art is the only way to
 * get the specific casting, color, and collector number reliably. This
 * calls Gemini's vision API (free tier, no card required) to do that.
 *
 * Requires secret: GEMINI_API_KEY.
 * Returns: { name, series, collectorNumber, year, variant, treasureHunt,
 *            tier, confidence: "high"|"low" }
 * confidence is a plain read of the model's own self-reported certainty,
 * never fabricated — "low" means the model itself wasn't sure, and the
 * app treats that as a suggestion to confirm, not an auto-fill.
 */
async function handleIdentify(request, env, headers) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }
  if (!env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "not_configured", detail: "GEMINI_API_KEY secret not set" }), {
      status: 501,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "bad_request", detail: "invalid JSON body" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }

  const { front, back, barcode } = body || {};
  if (!front && !back) {
    return new Response(JSON.stringify({ error: "missing_images" }), {
      status: 400,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }

  const promptText =
    "You are identifying a die-cast car from photo(s) — it's either an official packaged " +
    "Hot Wheels/Matchbox-style card, or a loose/customized car with no packaging. " +
    (barcode ? `The barcode (if relevant) is ${barcode} — this usually identifies the assortment/series, not the exact casting. ` : "") +
    "If it's on official packaging: read the card art, printed collector number, series name, " +
    "and any Treasure Hunt marking. " +
    "If it looks like a custom, kitbashed, or repainted car with no matching official packaging: " +
    "set isCustom to true, leave name/series/collectorNumber empty, and instead write a short plain-English " +
    "visual description in searchDescription — body style, color, finish, wheels, any visible decals — " +
    "specific enough to search a marketplace for visually similar customs (e.g. " +
    '"custom black resin muscle car with red flame decals and gold 5-spoke wheels"). ' +
    "Respond with ONLY a JSON object, no markdown, no explanation, in exactly this shape: " +
    '{"name":"","series":"","collectorNumber":"","year":"","variant":"","treasureHunt":false,"tier":"",' +
    '"isCustom":false,"searchDescription":"","confidence":"high|low"}. ' +
    'Use "" / false for any field that does not apply. Set confidence to "low" if the photo is unclear, ' +
    "partially obscured, or you are guessing rather than reading printed text or clear visual details.";

  const parts = [{ text: promptText }];
  if (front) parts.push({ inline_data: { mime_type: "image/jpeg", data: front } });
  if (back) parts.push({ inline_data: { mime_type: "image/jpeg", data: back } });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" }
        })
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "gemini_api_error", status: res.status, detail }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    const data = await res.json();
    const text =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!text) {
      return new Response(JSON.stringify({ error: "empty_response" }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return new Response(JSON.stringify({ error: "unparseable_response", raw: text }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...headers, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "worker_error", detail: String(err) }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }
}
