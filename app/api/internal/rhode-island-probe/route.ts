import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const osp = "https://webprocure.proactiscloud.com/wp-web-public/";
const rivip = "https://www.purchasing.ri.gov/bidding/ExternalBidSearch.aspx";

function summarizeRivip(html: string) {
  const $ = load(html);
  const tables = $("table").toArray().map((table, tableIndex) => ({
    tableIndex,
    id: $(table).attr("id") || "",
    className: $(table).attr("class") || "",
    rows: $(table).find("tr").toArray().slice(0, 50).map((row, rowIndex) => ({
      rowIndex,
      cells: $(row).find("th,td").toArray().map(cell => $(cell).text().replace(/\s+/g, " ").trim()),
      links: $(row).find("a[href]").toArray().map(a => ({ text: $(a).text().replace(/\s+/g, " ").trim(), href: $(a).attr("href") || "" })),
    })),
  })).filter(table => table.rows.some(row => row.cells.some(cell => /bid|solicitation|closing|agency|school|city|rfp|rfq/i.test(cell))));

  const selects = $("select").toArray().map(el => ({
    id: $(el).attr("id") || "",
    name: $(el).attr("name") || "",
    options: $(el).find("option").toArray().slice(0, 100).map(o => ({ value: $(o).attr("value") || "", text: $(o).text().replace(/\s+/g, " ").trim(), selected: $(o).is(":selected") })),
  }));

  const buttons = $("input[type=submit], input[type=button], button, a[href]").toArray().map(el => ({
    id: $(el).attr("id") || "",
    name: $(el).attr("name") || "",
    value: $(el).attr("value") || $(el).text().replace(/\s+/g, " ").trim(),
    href: $(el).attr("href") || "",
  })).filter(x => /search|bid|next|page|view|detail/i.test(`${x.id} ${x.name} ${x.value} ${x.href}`)).slice(0, 120);

  return { title: $("title").text().replace(/\s+/g, " ").trim(), tables, selects, buttons };
}

export async function GET() {
  const results: unknown[] = [];
  try {
    const response = await fetch(osp, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    const text = await response.text();
    results.push({ name: "OSP", status: response.status, finalUrl: response.url, length: text.length, sample: text.slice(0, 3000) });
  } catch (error) {
    results.push({ name: "OSP", error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const response = await fetch(rivip, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    const text = await response.text();
    results.push({ name: "RIVIP", status: response.status, finalUrl: response.url, length: text.length, summary: summarizeRivip(text) });
  } catch (error) {
    results.push({ name: "RIVIP", error: error instanceof Error ? error.message : String(error) });
  }

  return NextResponse.json({ results });
}
