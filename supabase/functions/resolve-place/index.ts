import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractPlaceId(url: string): string | null {
  // ftid=0x...:0x... format
  const ftid = url.match(/ftid=(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftid) return ftid[1];
  // !1s0x...:0x... in data param
  const data = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (data) return data[1];
  // /place/.../@.../ with ChIJ style id
  const chi = url.match(/place_id[=:](ChIJ[A-Za-z0-9_-]+)/);
  if (chi) return chi[1];
  return null;
}

// A "Share" link from the Maps app redirects to a `?q=Name, Street, City, Zip`
// URL — the full address is already embedded there, comma-separated after the
// name. A `/maps/place/Name/@lat,lng` URL (typed/generated, not shared) has no
// address embedded anywhere.
function extractPlaceInfoFromUrl(url: string): { name: string | null; address: string | null } {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/maps\/place\/([^/@]+)/);
    if (m) {
      const full = decodeURIComponent(m[1].replace(/\+/g, " "));
      return { name: full.split(",")[0].trim(), address: null };
    }
    const q = u.searchParams.get("q");
    if (q) {
      const parts = q.split(",").map((p) => p.trim());
      return { name: parts[0], address: parts.length > 1 ? parts.slice(1).join(", ") : null };
    }
  } catch { /* */ }
  return { name: null, address: null };
}

function extractCoordsFromUrl(url: string): { lat: number; lng: number } | null {
  const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

async function resolveShortUrl(url: string): Promise<string> {
  const resp = await fetch(url, { redirect: "manual" });
  return resp.headers.get("location") ?? url;
}

// Google's server-rendered Maps HTML carries no place-specific data at all —
// title/description/image meta tags are always the same generic boilerplate
// regardless of the place (the real content is loaded client-side via JS).
// So this is a last-resort fallback for URLs with neither a `/place/` path
// nor a `q=` param, and will usually come back empty.
async function fetchTitle(url: string): Promise<string | null> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HangoutBot/1.0)", Accept: "text/html" },
    redirect: "follow",
  });
  const html = await resp.text();
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m) return null;
  const title = m[1]
    .trim()
    .replace(/\s*[-–—·|]\s*(Google Maps|Карти Google|Google Карти).*$/i, "")
    .trim();
  if (title.length === 0 || title.length >= 200) return null;
  return title.split(",")[0].trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") return json({ error: "url required" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let resolved = url;
    if (/goo\.gl|maps\.app\.goo\.gl/i.test(url)) {
      resolved = await resolveShortUrl(url);
    }

    const googlePlaceId = extractPlaceId(resolved);

    if (googlePlaceId) {
      const { data: cached } = await db
        .from("places")
        .select("id, name, maps_url, lat, lng, address, photo_url")
        .eq("google_place_id", googlePlaceId)
        .maybeSingle();
      if (cached) {
        return json({ ...cached, google_place_id: googlePlaceId, cached: true });
      }
    }

    const info = extractPlaceInfoFromUrl(resolved);
    const name = info.name ?? (await fetchTitle(resolved));
    const coords = extractCoordsFromUrl(resolved);

    return json({
      name: name ?? null,
      google_place_id: googlePlaceId,
      resolved,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      address: info.address,
      photo_url: null,
    });
  } catch {
    return json({ error: "failed to resolve" }, 500);
  }
});
