import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const targets = [
  {
    key: "missouri_abstracts",
    url: "https://ewqg.fa.us8.oraclecloud.com/fscmUI/redwood/negotiation-abstracts/view/abstractlisting?prcBuId=300000005255687&ojSpLang=en",
  },
  { key: "kentucky", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { key: "ohio_public", url: "https://ohiobuys.ohio.gov/page.aspx/en/rfp/request_browse_public" },
];

function pick(text: string, pattern: RegExp, limit = 60) {
  return [...text.matchAll(pattern)].slice(0, limit).map(match => match[0]);
}

function snippets(text: string, needles: string[], limit = 40) {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const needle of needles) {
    let from = 0;
    while (out.length < limit) {
      const index = lower.indexOf(needle.toLowerCase(), from);
      if (index < 0) break;
      out.push(text.slice(Math.max(0, index - 700), Math.min(text.length, index + 1400)));
      from = index + needle.length;
    }
  }
  return out;
}

function resolve(base: string, value: string) {
  try { return new URL(value.replace(/&amp;/g, "&"), base).toString(); } catch { return value; }
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const results = [];
  for (const target of targets) {
    try {
      const response = await fetch(target.url, {
        redirect: "follow",
        cache: "no-store",
        headers: {
          accept: "text/html,application/xhtml+xml,application/json",
          "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
        },
      });
      const body = await response.text();
      const scriptTags = pick(body, /<script\b[^>]*src=["'][^"']+["'][^>]*>/gi, 80);
      const scriptUrls = scriptTags.flatMap(tag => {
        const match = tag.match(/src=["']([^"']+)["']/i);
        return match ? [resolve(response.url, match[1])] : [];
      });

      const scriptFindings: Array<{ url: string; size: number; snippets: string[] }> = [];
      for (const scriptUrl of scriptUrls.slice(-12)) {
        try {
          const scriptResponse = await fetch(scriptUrl, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
          if (!scriptResponse.ok) continue;
          const scriptText = await scriptResponse.text();
          const found = snippets(scriptText, ["business opportunities", "request_browse_public", "solicitation", "negotiation", "abstractlisting", "/api/", "fetch(", "XMLHttpRequest"], 20);
          if (found.length) scriptFindings.push({ url: scriptUrl, size: scriptText.length, snippets: found });
        } catch {
          // Diagnostic probe only.
        }
      }

      results.push({
        key: target.key,
        requested: target.url,
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        size: body.length,
        forms: pick(body, /<form\b[^>]*>/gi, 20),
        scripts: scriptUrls,
        urls: [...new Set(pick(body, /https?:\\?\/\\?\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\\-]+/gi, 150))],
        bodySnippets: snippets(body, ["Business Opportunities", "Public Solicitations", "solicitation", "negotiation", "abstract", "request_browse_public", "datasource", "actionUrl", "service"], 50),
        scriptFindings,
        head: body.slice(0, 6000),
      });
    } catch (error) {
      results.push({ key: target.key, requested: target.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
