import { load } from "cheerio";

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

function normalize(value: string) {
  return value.replace(/\+/g, " ").replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

function findSignedUrl(html: string, pageUrl: string, filename: string) {
  const $ = load(html);
  const wanted = normalize(filename);
  let found = "";
  $('a[href*="solutions-selectsite-documents.s3.amazonaws.com"]').each((_, node) => {
    if (found) return;
    const href = $(node).attr("href") || "";
    const pathName = (() => { try { return decodeURIComponent(new URL(href, pageUrl).pathname.split("/").pop() || ""); } catch { return ""; } })();
    if (normalize(pathName) === wanted || normalize($(node).text()) === wanted) {
      try { found = new URL(href, pageUrl).toString(); } catch {}
    }
  });
  return found;
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

export async function refreshJaggaerEventDocument(sourceBaseUrl: string, filename: string, signal: AbortSignal, userAgent: string) {
  if (!sourceBaseUrl) return null;
  const initial = await fetch(sourceBaseUrl, {
    redirect: "follow",
    signal,
    cache: "no-store",
    headers: { accept: "text/html,application/xhtml+xml,*/*", "user-agent": userAgent },
  });
  if (!initial.ok) return null;
  const html = await initial.text();
  let found = findSignedUrl(html, initial.url, filename);
  if (found) return found;
  const full = buildFullResultRequest(html, initial.url);
  if (!full) return null;
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
  if (!expanded.ok) return null;
  found = findSignedUrl(await expanded.text(), expanded.url, filename);
  return found || null;
}
