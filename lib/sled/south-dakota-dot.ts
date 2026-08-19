import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const INDEX_URL = "https://apps.sd.gov/HC65BidLetting/ebslettings1.aspx";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

const SOURCE: SledSourceConfig = {
  adapterKey: "sddot_bid_lettings_sd",
  sourceName: "South Dakota DOT SDEBS Advertised Lettings",
  baseUrl: INDEX_URL,
  jurisdiction: "South Dakota",
  sourceType: "website",
};

export interface SouthDakotaDotSyncResult {
  stateCode: "SD";
  sourceName: string;
  ok: boolean;
  lettingCount: number;
  sourceCount: number;
  rowsFetched: number;
  actionableRows: number;
  complete: boolean;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
  error?: string;
}

function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }

function dueAtFromLabel(label: string) {
  const parsed = new Date(`${label} 10:00:00 GMT-0500`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function projectIdFromText(text: string) {
  const pcn = text.match(/PCN\s*-\s*([A-Z0-9]+)/i)?.[1];
  if (pcn) return pcn.toUpperCase();
  return text.slice(0, 120);
}

async function fetchHtml(url: string) {
  const response = await fetch(url, { redirect: "follow", cache: "no-store", headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA } });
  if (!response.ok) throw new Error(`SDDOT returned ${response.status} for ${url}`);
  return { html: await response.text(), url: response.url };
}

export async function syncSouthDakotaDot(): Promise<SouthDakotaDotSyncResult> {
  try {
    const index = await fetchHtml(INDEX_URL);
    const $ = load(index.html);
    const body = compact($("body").text());
    const advertisedText = body.match(/Lettings Currently Advertised for Bids:(.*?)Status of Lettings Post Bid Opening:/i)?.[1] || "";
    const lettingLinks = $("a[href]").toArray().flatMap(a => {
      const label = compact($(a).text());
      const href = $(a).attr("href") || "";
      if (!/^\w+ \d{1,2}, 2026$/.test(label) || !advertisedText.includes(label) || !/ebslettingsdetail1\.aspx/i.test(href)) return [];
      return [{ label, url: new URL(href, index.url).toString() }];
    });
    if (!lettingLinks.length) throw new Error("SDDOT advertised lettings section returned no letting links");

    const records: SledOpportunityRecord[] = [];
    for (const letting of lettingLinks) {
      const detail = await fetchHtml(letting.url);
      const $d = load(detail.html);
      const projectRows = $d("tr").toArray().filter(row => {
        const cells = $d(row).find("td").toArray().map(cell => compact($d(cell).text()));
        return cells.length >= 2 && /PCN\s*-/i.test(cells[1] || "");
      });
      if (!projectRows.length) throw new Error(`SDDOT letting ${letting.label} returned no project rows`);

      for (const row of projectRows) {
        const cells = $d(row).find("td").toArray().map(cell => compact($d(cell).text()));
        const contract = cells[1] || "";
        const pcn = projectIdFromText(contract);
        const area = contract.match(/PCN\s*-\s*[A-Z0-9]+\s*(.*?)\s*\d+\s*-\s*addendums/i)?.[1]?.trim() || null;
        const workType = contract.match(/Work Type\s+(.+?)Plan Holder List/i)?.[1]?.trim() || null;
        const links = $d(row).find("a[href]").toArray().map(a => ({ text: compact($d(a).text()), href: new URL($d(a).attr("href") || "", detail.url).toString() }));
        const title = contract.replace(/\d+\s*-\s*addendums.*$/i, "").trim();
        const record: SledOpportunityRecord = {
          externalId: `${letting.label}:${pcn}`,
          agency: {
            key: "south-dakota-department-of-transportation",
            name: "South Dakota Department of Transportation",
            agencyType: "state_agency",
            jurisdictionLevel: "state",
            stateCode: "SD",
            website: INDEX_URL,
          },
          title,
          description: area ? `SDDOT highway letting project in ${area}.` : null,
          solicitationType: "Highway Construction Bid",
          procurementMechanism: "South Dakota Electronic Bid System (SDEBS) advertised letting",
          status: "open",
          issueDate: null,
          dueAt: dueAtFromLabel(letting.label),
          stateCode: "SD",
          sourceUrl: letting.url,
          rawPayload: {
            platform: "South Dakota DOT SDEBS",
            lettingDate: letting.label,
            pcn,
            area,
            workType,
            itemNumber: cells[0] || null,
            links,
          },
        };
        records.push(record);
      }
    }

    const unique = new Set(records.map(record => record.externalId));
    if (unique.size !== records.length) throw new Error(`SDDOT reconciliation failed: rows=${records.length}, unique=${unique.size}`);
    const persisted = await persistSledOpportunities(SOURCE, records, { mode: "south_dakota_dot_advertised_lettings_refresh", recordChanges: true, closeMissing: true });
    return { stateCode: "SD", sourceName: SOURCE.sourceName, ok: true, lettingCount: lettingLinks.length, sourceCount: records.length, rowsFetched: records.length, actionableRows: records.length, complete: true, ...persisted };
  } catch (error) {
    return { stateCode: "SD", sourceName: SOURCE.sourceName, ok: false, lettingCount: 0, sourceCount: 0, rowsFetched: 0, actionableRows: 0, complete: false, stored: 0, newRecords: 0, changedRecords: 0, closedRecords: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
