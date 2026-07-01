/**
 * Cloudflare Worker CORS proxy for the NTK donation ledger dashboard.
 *
 * WHY: donate.naamtamilar.org's API doesn't send CORS headers, so it can't
 * be called directly from a browser on another domain. This worker runs
 * on Cloudflare's edge (not in anyone's browser), fetches the upstream API
 * server-side, and returns the response with CORS headers added - so any
 * visitor's browser can then call THIS worker instead of the API directly.
 *
 * DEPLOY (free, ~2 minutes, no account card required for the free tier)
 * ------------------------------------------------------------------
 * 1. Go to https://workers.cloudflare.com and sign up / log in.
 * 2. Dashboard -> Workers & Pages -> Create -> Create Worker.
 * 3. Give it a name (e.g. "ntk-donation-proxy") -> Deploy (uses default template).
 * 4. Click "Edit code", delete everything, paste this whole file, click "Deploy".
 * 5. You'll get a URL like: https://ntk-donation-proxy.<yoursubdomain>.workers.dev
 * 6. Put that URL into ntk_donation_ledger.html as HOSTED_PROXY (see that
 *    file's script section) OR just type it into the "API mode" box on
 *    the page and click "Use this".
 *
 * OPTIONAL: light caching is included below (60s) so that if many visitors
 * load the dashboard at once, you're not hammering the upstream API with
 * duplicate requests for the same page/stats.
 */

const UPSTREAM = "https://donate.naamtamilar.org/api/proxy//Public/Donation_v1";
const CACHE_SECONDS = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const upstreamUrl = UPSTREAM + url.pathname + url.search;

    // Use Cloudflare's edge cache to avoid re-fetching the same page
    // from upstream repeatedly within the cache window.
    const cache = caches.default;
    const cacheKey = new Request(upstreamUrl, request);
    let response = await cache.match(cacheKey);

    if (!response) {
      try {
        const upstreamResp = await fetch(upstreamUrl, {
          headers: {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://donate.naamtamilar.org/contributors",
          },
        });

        const body = await upstreamResp.text();
        response = new Response(body, {
          status: upstreamResp.status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
            ...CORS_HEADERS,
          },
        });

        if (upstreamResp.status === 200) {
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
    } else {
      // Re-attach CORS headers on cached responses too
      response = new Response(response.body, response);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
    }

    return response;
  },
};
