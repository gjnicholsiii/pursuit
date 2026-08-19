import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TARGETS = [
  "https://www.dms.myflorida.com/business_operations/state_purchasing/vendor_resources/solicitations_vendor_bid_system",
  "https://vendor.myfloridamarketplace.com/",
  "https://vendor.myfloridamarketplace.com/search/bids",
  "https://vendor.myfloridamarketplace.com/vms-web/spring/login?execution=e1s1",
];

export async function GET() {
  const results = [];
  for (const url of TARGETS) {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
        redirect: "follow",
        cache: "no-store",
      });
      const html = await response.text();
      const $ = load(html);
      const links = $("a[href]").map((_, el) => ({ text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href") || "" })).get();
      const forms = $("form").map((_, el) => ({ action: $(el).attr("action") || "", method: $(el).attr("method") || "" })).get();
      const scripts = $("script[src]").map((_, el) => $(el).attr("src") || "").get();
      const rawMatches = [...new Set((html.match(/https?:[^\"'<>\s]+/g) || []).filter(v => /vendor|bid|solicit|vip|ariba|myfloridamarketplace/i.test(v)).slice(0,100))];
      results.push({url,status:response.status,finalUrl:response.url,title:$("title").text().trim(),links:links.filter(x=>/bid|solicit|vendor|vip|opportun/i.test(`${x.text} ${x.href}`)).slice(0,100),forms,scripts:scripts.slice(0,30),rawMatches,head:html.slice(0,8000)});
    } catch (error) {
      results.push({url,error:error instanceof Error ? error.message : String(error)});
    }
  }
  return NextResponse.json({ok:true,results});
}
