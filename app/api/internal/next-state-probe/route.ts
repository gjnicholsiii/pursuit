import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const NC = "https://evp.nc.gov/solicitations/?status=0";
const CA = "https://caleprocure.ca.gov/psp/psfpd1_3/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL";

function summarizeHtml(html: string) {
  const $ = load(html);
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const scripts = $("script").toArray().map(node => $(node).html() || "").filter(Boolean);
  return {
    title: $("title").text().replace(/\s+/g, " ").trim(),
    htmlLength: html.length,
    bodyStart: body.slice(0, 5000),
    tables: $("table").length,
    rows: $("table tr").length,
    forms: $("form").toArray().slice(0, 10).map(form => ({
      id: $(form).attr("id") || null,
      action: $(form).attr("action") || null,
      method: $(form).attr("method") || null,
    })),
    links: $("a").toArray().map(a => ({ text: $(a).text().replace(/\s+/g, " ").trim(), href: $(a).attr("href") || null })).filter(x => x.text || x.href).slice(0, 80),
    scriptHits: scripts.filter(s => /entitylist|liquid|fetchxml|odata|_api|solicitation|AUC_RESP|SCP|PORTAL/i.test(s)).slice(0, 12).map(s => s.slice(0, 6000)),
    hiddenInputs: $("input[type=hidden]").toArray().slice(0, 60).map(input => ({ name: $(input).attr("name") || null, id: $(input).attr("id") || null, value: ($(input).attr("value") || "").slice(0, 500) })),
  };
}

async function probeNc() {
  const response = await fetch(NC, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await response.text();
  return { status: response.status, finalUrl: response.url, ...summarizeHtml(html) };
}

async function probeCa() {
  const first = await fetch(CA, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "manual",
    cache: "no-store",
  });
  const setCookies = typeof first.headers.getSetCookie === "function" ? first.headers.getSetCookie() : [];
  const fallbackCookie = first.headers.get("set-cookie");
  const cookies = (setCookies.length ? setCookies : fallbackCookie ? [fallbackCookie] : []).map(v => v.split(";", 1)[0]).join("; ");
  const location = first.headers.get("location");
  const nextUrl = location ? new URL(location, CA).toString() : CA;
  const second = location || cookies ? await fetch(nextUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      ...(cookies ? { cookie: cookies } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  }) : first;
  const html = await second.text();
  return { firstStatus: first.status, firstLocation: location, cookieNames: cookies.split("; ").filter(Boolean).map(v => v.split("=")[0]), status: second.status, finalUrl: second.url, ...summarizeHtml(html) };
}

export async function GET() {
  const [nc, ca] = await Promise.allSettled([probeNc(), probeCa()]);
  return NextResponse.json({
    nc: nc.status === "fulfilled" ? nc.value : { error: String(nc.reason) },
    ca: ca.status === "fulfilled" ? ca.value : { error: String(ca.reason) },
  });
}
