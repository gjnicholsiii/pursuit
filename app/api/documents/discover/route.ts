import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|zip|txt)(?:$|[?#])/i;

function safeName(url: string, fallback = "document") {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || fallback);
    return name.replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim() || fallback;
  } catch { return fallback; }
}

function isHttp(value: string) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

type OpportunityRow = {
  id: string;
  source_url: string;
  agency_type: string;
  source_name: string;
};

type ScanResult = {
  opportunityId: string;
  agencyType: string;
  sourceName: string;
  discovered: number;
  inserted: number;
  status: number;
};

async function scanOne(opp: OpportunityRow): Promise<ScanResult> {
  const sql = getSql();
  let status = 0;
  const discovered = new Set<string>();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(opp.source_url, {
      redirect:"follow",
      signal:controller.signal,
      cache:"no-store",
      headers:{"User-Agent":"Pursuit/1.0 procurement document discovery", Accept:"text/html,application/pdf,*/*"},
    });
    status = response.status;
    if (!response.ok) return { opportunityId:opp.id, agencyType:opp.agency_type, sourceName:opp.source_name, discovered:0, inserted:0, status };

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/pdf") || FILE_EXT.test(response.url)) {
      discovered.add(response.url);
    } else {
      const html = await response.text();
      const $ = cheerio.load(html);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const absolute = new URL(href, response.url).toString();
          if (isHttp(absolute) && FILE_EXT.test(absolute)) discovered.add(absolute);
        } catch {}
      });
    }
  } catch {
    return { opportunityId:opp.id, agencyType:opp.agency_type, sourceName:opp.source_name, discovered:0, inserted:0, status };
  } finally {
    clearTimeout(timeout);
  }

  let inserted = 0;
  for (const url of [...discovered].slice(0, 50)) {
    const result = await sql.query(
      `insert into opportunity_documents (opportunity_id, document_type, filename, source_url, referenced_by, extraction_status)
       select $1, 'sled_resource', $2, $3, $4, 'pending'
       where not exists (select 1 from opportunity_documents where opportunity_id=$1 and source_url=$3)
       returning id`,
      [opp.id, safeName(url, `${opp.agency_type}-document`), url, `${opp.source_name} source page`],
    ) as Array<{id:string}>;
    inserted += result.length;
  }

  return { opportunityId:opp.id, agencyType:opp.agency_type, sourceName:opp.source_name, discovered:discovered.size, inserted, status };
}

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(
    `select o.id, o.source_url, a.agency_type, s.source_name
     from opportunities o
     join agencies a on a.id=o.agency_id
     join sources s on s.id=o.source_id
     where s.source_family='sled'
       and s.adapter_key <> 'opengov_public'
       and o.status='open'
       and (o.due_at is null or o.due_at >= now())
       and not exists (select 1 from opportunity_documents d where d.opportunity_id=o.id)
     order by case when a.agency_type='k12' then 0 when a.agency_type='higher_ed' then 1 else 2 end,
              o.due_at asc nulls last,
              o.last_seen_at desc
     limit 100`,
  ) as OpportunityRow[];

  if (!rows.length) return NextResponse.json({ ok:true, scannedCount:0, message:"No undiscovered open non-OpenGov SLED opportunities remain" });

  const scanned: ScanResult[] = [];
  const concurrency = 8;
  for (let i=0;i<rows.length;i+=concurrency) {
    scanned.push(...await Promise.all(rows.slice(i,i+concurrency).map(scanOne)));
  }
  const totalInserted = scanned.reduce((sum,row)=>sum+row.inserted,0);
  const withDocuments = scanned.filter(row=>row.inserted>0).length;

  return NextResponse.json({ ok:true, scannedCount:scanned.length, withDocuments, totalInserted, scanned });
}
