import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_BASE = "https://api.procurement.opengov.com/api/v1";

function summarizeJson(value: unknown) {
  if (Array.isArray(value)) return { type: "array", length: value.length, sample: value.slice(0, 2) };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 40), sample: value };
  return { type: typeof value, sample: value };
}

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(
    `select o.id,
            o.raw_payload->'project'->>'id' as project_id,
            o.raw_payload->'government'->>'code' as government_code
     from opportunities o
     join agencies a on a.id=o.agency_id
     join sources s on s.id=o.source_id
     where s.adapter_key='opengov_public'
       and a.agency_type='k12'
       and o.status='open'
       and o.raw_payload->'project'->>'id' is not null
       and o.raw_payload->'government'->>'code' is not null
     order by o.due_at asc nulls last
     limit 1`,
  ) as Array<{id:string; project_id:string; government_code:string}>;

  const opp = rows[0];
  if (!opp) return NextResponse.json({ ok:false, error:"No open K-12 OpenGov sample found" }, { status:404 });

  const id = opp.project_id;
  const code = opp.government_code;
  const attempts: Array<{ name:string; method:"GET"|"POST"; url:string; body?:unknown }> = [
    { name:"project-by-id", method:"GET", url:`${API_BASE}/project/${id}` },
    { name:"project-document", method:"GET", url:`${API_BASE}/project/${id}/document` },
    { name:"project-documents", method:"GET", url:`${API_BASE}/project/${id}/documents` },
    { name:"project-attachments", method:"GET", url:`${API_BASE}/project/${id}/attachments` },
    { name:"project-files", method:"GET", url:`${API_BASE}/project/${id}/files` },
    { name:"document-query", method:"GET", url:`${API_BASE}/project/document?projectId=${encodeURIComponent(id)}` },
    { name:"documents-query", method:"GET", url:`${API_BASE}/project/documents?projectId=${encodeURIComponent(id)}` },
    { name:"attachments-query", method:"GET", url:`${API_BASE}/project/attachments?projectId=${encodeURIComponent(id)}` },
    { name:"project-list-filter", method:"POST", url:`${API_BASE}/project/list`, body:{ governmentCode:code, publicView:true, projectId:Number(id), limit:10, page:1 } },
  ];

  const results = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: attempt.method,
        headers: { accept:"application/json", ...(attempt.method === "POST" ? {"content-type":"application/json"} : {}) },
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
        cache:"no-store",
      });
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      let parsed: unknown = text.slice(0, 600);
      if (contentType.includes("application/json") && text) {
        try { parsed = summarizeJson(JSON.parse(text)); } catch {}
      }
      results.push({ name:attempt.name, status:response.status, contentType, result:parsed });
    } catch (error) {
      results.push({ name:attempt.name, status:0, error:error instanceof Error ? error.message : String(error) });
    }
  }

  return NextResponse.json({ ok:true, opportunityId:opp.id, projectId:id, governmentCode:code, results });
}
