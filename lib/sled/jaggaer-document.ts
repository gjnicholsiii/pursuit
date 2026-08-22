import { load } from "cheerio";

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

function normalize(value: string) {
  return value.replace(/\+/g, " ").replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

function signedUrlMap(html: string, pageUrl: string) {
  const $ = load(html);
  const result = new Map<string, string>();
  $('a[href*="solutions-selectsite-documents.s3.amazonaws.com"]').each((_, node) => {
    const href = $(node).attr("href") || "";
    try {
      const url = new URL(href, pageUrl).toString();
      const pathName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
      if (pathName) result.set(normalize(pathName), url);
      const label = normalize($(node).text());
      if (label) result.set(label, url);
    } catch {}
  });
  return result;
}

function buildFullResultRequest(html: string, pageUrl: string) {
  const $ = load(html);
  const form = $('form[name="ActiveForm"]').first();
  if (!form.length) return null;
  const params = new URLSearchParams();
  form.find("input[name]").each((_, node) => {
    const input = $(node);
    const name = input.attr("name");
    if (!name) return;
    const type = (input.attr("type") || "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !input.is(":checked")) return;
    if (["submit", "button", "image", "file"].includes(type)) return;
    params.append(name, input.attr("value") || "");
  });
  form.find("select[name]").each((_, node) => {
    const select = $(node);
    const name = select.attr("name");
    if (!name) return;
    params.set(name, select.find("option:selected").attr("value") || select.find("option").first().attr("value") || "");
  });
  params.set("PageSize", "200");
  params.set("PageNum", "1");
  params.set("ESSearchAfter", "");
  try { return { url: new URL(form.attr("action") || pageUrl, pageUrl).toString(), params }; } catch { return null; }
}

export async function refreshJaggaerEventDocuments(sourceBaseUrl: string, filenames: string[], signal: AbortSignal, userAgent: string) {
  const wanted = new Map(filenames.map(filename => [normalize(filename), filename]));
  const found = new Map<string, string>();
  if (!sourceBaseUrl || !wanted.size) return found;

  const initial = await fetch(sourceBaseUrl, {
    redirect: "follow",
    signal,
    cache: "no-store",
    headers: { accept: "text/html,application/xhtml+xml,*/*", "user-agent": userAgent },
  });
  if (!initial.ok) return found;
  const html = await initial.text();
  const first = signedUrlMap(html, initial.url);
  for (const [key, original] of wanted) if (first.has(key)) found.set(original, first.get(key) as string);
  if (found.size === wanted.size) return found;

  const full = buildFullResultRequest(html, initial.url);
  if (!full) return found;
  const cookie = cookieHeader(initial.headers.get("set-cookie"));
  const expanded = await fetch(full.url, {
    method: "POST",
    redirect: "follow",
    signal,
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml,*/*",
      "content-type": "application/x-www-form-urlencoded",
      referer: initial.url,
      ...(cookie ? { cookie } : {}),
      "user-agent": userAgent,
    },
    body: full.params,
  });
  if (!expanded.ok) return found;
  const second = signedUrlMap(await expanded.text(), expanded.url);
  for (const [key, original] of wanted) if (!found.has(original) && second.has(key)) found.set(original, second.get(key) as string);
  return found;
}

export async function refreshJaggaerEventDocument(sourceBaseUrl: string, filename: string, signal: AbortSignal, userAgent: string) {
  return (await refreshJaggaerEventDocuments(sourceBaseUrl, [filename], signal, userAgent)).get(filename) || null;
}
