import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const base = "https://financials.ok.gov";
const publicUrl = base + "/psc/SOKLFP1DS/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL";

function cookieHeader(values: string[]) {
  const jar = new Map<string,string>();
  for (const raw of values) {
    for (const part of raw.split(/,(?=[^;,]+=)/)) {
      const token = part.split(";")[0].trim();
      const eq = token.indexOf("=");
      if (eq > 0) jar.set(token.slice(0, eq), token.slice(eq + 1));
    }
  }
  return [...jar].map(([k,v]) => `${k}=${v}`).join("; ");
}

function summarize(html: string) {
  const $ = load(html);
  const rows = new Map<string, { id:string; text:string; href:string|null }>();
  $('[id*="SCP_PUB_AUC_VW"], a[href*="SCP_PUB_AUC_VW"]').each((_, el) => {
    const node = $(el);
    const id = node.attr("id") || node.attr("name") || "";
    const text = node.text().replace(/\s+/g," ").trim();
    const href = node.attr("href") || null;
    if ((id || href) && text) rows.set(`${id}|${href}|${text}`, { id, text, href });
  });
  const bodyText = $("body").text().replace(/\s+/g," ").trim();
  const countMatches = [...bodyText.matchAll(/\b(\d+)\s*(?:of|-)\s*(\d+)\b/gi)].map(m => m[0]);
  const inputs = $('input[name],select[name]').toArray().map(el => ({
    name: $(el).attr('name') || '', id: $(el).attr('id') || '', value: $(el).attr('value') || '', type: $(el).attr('type') || el.tagName,
  })).filter(x => /SCP|AUC|ICAction|ICStateNum|ICResubmit|ICXPos|ICYPos/i.test(`${x.name} ${x.id}`));
  return { title: $('title').text().trim(), rows: [...rows.values()].slice(0,120), countMatches: [...new Set(countMatches)].slice(0,20), inputs: inputs.slice(0,120), bodyTail: bodyText.slice(-5000) };
}

export async function GET() {
  const first = await fetch(publicUrl, { redirect:"manual", headers:{accept:"text/html,application/xhtml+xml","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"}, cache:"no-store" });
  const location = first.headers.get('location');
  const jar1 = cookieHeader([first.headers.get('set-cookie') || '']);
  const second = await fetch(location ? new URL(location, base).toString() : publicUrl, { redirect:"follow", headers:{accept:"text/html,application/xhtml+xml",cookie:jar1,"user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"}, cache:"no-store" });
  const html = await second.text();
  return NextResponse.json({ status: second.status, finalUrl: second.url, cookieNames: jar1.split('; ').map(x=>x.split('=')[0]), summary: summarize(html) });
}
