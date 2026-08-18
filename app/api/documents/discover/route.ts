import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|zip|txt)(?:$|[?#])/i;
const LINK_HINT = /(download|attachment|document|solicitation|rfp|rfq|bid|addendum|specification|drawing|form)/i;

function safeName(url: string, fallback = "document") {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || fallback);
    return name.replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim() || fallback;
  } catch { return fallback; }
}

function isHttp(value: string) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

interface Candidate {
  id: string;
  source_url: string;
  agency_type: string;
  source_name: string;
}

async function discoverLinks(candidate: Candidate) {
  const response = await fetch(candidate.source_url, {
    redirect: "follow",
    cache: "no-store",
    headers: { "User-Agent": "Pursuit/0.1", Accept: "text/html,application/pdf,*/*" },
  });

  if (!response.ok) return { links: new Set<string>(), status: response.status };

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const discovered = new Set<string>();

  if (contentType.includes("application/pdf") || FILE_EXT.test(response.url)) {
    discovered.add(response.url);
  } else {
    const html = await response.text();
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (!href) return;
      try {
        const absolute = new URL(href, response.url).toString();
        if (isHttp(absolute) && (FILE_EXT.test(absolute) || LINK_HINT.test(`${absolute} ${text}`))) {
          discovered.add(absolute);
        }
      } catch {}
    });
  }

  return { links: discovered, status: response.status };
}

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(
    `select o.id, o.source_url, a.agency_type, s.source_name
     from opportunities o
     join agencies a on a.id=o.agency_id
     join sources s on s.id=o.source_id
     where s.source_family='sled'
       and o.status='open'
       and (o.due_at is null or o.due_at >= now())
       and not exists (select 1 from opportunity_documents d where d.opportunity_id=o.id)
     order by case when a.agency_type='k12' then 0 when a.agency_type='higher_ed' then 1 else 2 end,
              o.due_at asc nulls last,
              o.id
     limit 25`,
  ) as Candidate[];

  if (!rows.length) {
    return NextResponse.json({ ok: true, message: "No undiscovered open SLED opportunities remain" });
  }

  const scanned: Array<{ opportunityId: string; agencyType: string; sourceName: string; discovered: number; inserted: number; status: number }> = [];
  let totalInserted = 0;

  for (const candidate of rows) {
    try {
      const result = await discoverLinks(candidate);
      let inserted = 0;

      for (const url of [...result.links].slice(0, 50)) {
        const created = await sql.query(
          `insert into opportunity_documents (opportunity_id, document_type, filename, source_url, referenced_by, extraction_status)
           select $1, 'sled_resource', $2, $3, $4, 'pending'
           where not exists (select 1 from opportunity_documents where opportunity_id=$1 and source_url=$3)
           returning id`,
          [candidate.id, safeName(url, `${candidate.agency_type}-document`), url, `${candidate.source_name} source page`],
        ) as Array<{ id: string }>;
        inserted += created.length;
      }

      totalInserted += inserted;
      scanned.push({
        opportunityId: candidate.id,
        agencyType: candidate.agency_type,
        sourceName: candidate.source_name,
        discovered: result.links.size,
        inserted,
        status: result.status,
      });

      if (inserted > 0) break;
    } catch {
      scanned.push({
        opportunityId: candidate.id,
        agencyType: candidate.agency_type,
        sourceName: candidate.source_name,
        discovered: 0,
        inserted: 0,
        status: 0,
      });
    }
  }

  return NextResponse.json({ ok: true, scannedCount: scanned.length, totalInserted, scanned });
}
