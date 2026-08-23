import { getSql } from "@/lib/db";

type UrbanRecord = Record<string, unknown>;
type HigherEdRecord = { name:string; state:string; city:string|null; website:string|null; unitId:string|null };

type ImportResult = {
  fetched: number;
  accepted: number;
  inserted: number;
  updated: number;
  skipped: number;
  pages: number;
  totalReported: number | null;
  complete: boolean;
  resumed: boolean;
};

const BASE = "https://educationdata.urban.org/api/v1/college-university/ipeds/directory/2024/";
const PAGE_SIZE = 250;
const ENDPOINT = `${BASE}?per_page=${PAGE_SIZE}`;
const ADAPTER_KEY = "urban_ipeds_higher_ed";
const SOURCE_NAME = "Urban Institute IPEDS Higher Education Directory";

function text(row: UrbanRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function normalizeWebsite(value: string) {
  if (!value) return null;
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

function looksActive(row: UrbanRecord) {
  const status = text(row, "institution_status", "status", "active", "inst_status").toLowerCase();
  if (!status) return true;
  return !/(closed|inactive|out of business|deleted)/i.test(status);
}

function pickRecord(row: UrbanRecord): HigherEdRecord | null {
  const name = text(row, "institution_name", "inst_name", "instnm", "name");
  const state = text(row, "state_abbr", "state", "stabbr").toUpperCase().slice(0, 2);
  if (!name || !/^[A-Z]{2}$/.test(state)) return null;
  return {
    name,
    state,
    city: text(row, "city", "city_name") || null,
    website: normalizeWebsite(text(row, "website", "url", "institution_url", "webaddr")),
    unitId: text(row, "unitid", "unit_id") || null,
  };
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "Pursuit-Raven/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`IPEDS proxy returned ${response.status}`);
    return await response.json() as { results?: UrbanRecord[]; next?: string | null; count?: number } | UrbanRecord[];
  } finally { clearTimeout(timer); }
}

async function ensureSource() {
  const sql = getSql();
  const existing = await sql.query(`select id::text from sources where adapter_key=$1 limit 1`,[ADAPTER_KEY]) as Array<{id:string}>;
  if (existing[0]?.id) return existing[0].id;
  const inserted = await sql.query(`insert into sources(source_family,source_name,base_url,jurisdiction,source_type,adapter_key,active,health_score,last_success_at) values('reference',$1,$2,'United States','federal_reference',$3,true,1,now()) returning id::text`,[SOURCE_NAME,BASE,ADAPTER_KEY]) as Array<{id:string}>;
  return inserted[0].id;
}

async function checkpoint(sourceId:string) {
  const sql=getSql();
  const rows=await sql.query(`select id::text,diagnostics from source_runs where source_id=$1::uuid order by started_at desc limit 1`,[sourceId]) as Array<{id:string;diagnostics:Record<string,unknown>|null}>;
  const latest=rows[0];
  const diagnostics=latest?.diagnostics||{};
  if (diagnostics.complete===true) return { runId: latest.id, url:null, complete:true, resumed:true };
  const nextUrl=typeof diagnostics.nextUrl==='string'&&diagnostics.nextUrl?diagnostics.nextUrl:ENDPOINT;
  if (latest?.id && diagnostics.nextUrl) return { runId:latest.id,url:nextUrl,complete:false,resumed:true };
  const created=await sql.query(`insert into source_runs(source_id,started_at,status,records_seen,records_new,records_changed,documents_fetched,error_count,diagnostics) values($1::uuid,now(),'running',0,0,0,0,0,jsonb_build_object('nextUrl',$2::text,'complete',false,'pageSize',$3::int)) returning id::text`,[sourceId,ENDPOINT,PAGE_SIZE]) as Array<{id:string}>;
  return { runId:created[0].id,url:ENDPOINT,complete:false,resumed:false };
}

async function persistBatch(records: HigherEdRecord[]) {
  if (!records.length) return { inserted:0, updated:0 };
  const sql = getSql();
  const payload = JSON.stringify(records);
  const result = await sql.query(`
    with incoming as (
      select distinct on (lower(name), state)
        name, state, city, website, unit_id
      from jsonb_to_recordset($1::jsonb) as x(name text,state text,city text,website text,unit_id text)
      order by lower(name), state, unit_id nulls last
    ), updated as (
      update agencies a
      set city=coalesce(i.city,a.city), website=coalesce(i.website,a.website)
      from incoming i
      where a.agency_type='higher_ed' and lower(a.canonical_name)=lower(i.name) and coalesce(a.state_code,'')=i.state
      returning a.id
    ), inserted as (
      insert into agencies(canonical_name,agency_type,jurisdiction_level,state_code,city,website)
      select i.name,'higher_ed','institution',i.state,i.city,i.website
      from incoming i
      where not exists (select 1 from agencies a where a.agency_type='higher_ed' and lower(a.canonical_name)=lower(i.name) and coalesce(a.state_code,'')=i.state)
      returning id
    )
    select (select count(*) from inserted)::int inserted,(select count(*) from updated)::int updated
  `,[payload]) as Array<{inserted:number;updated:number}>;
  return result[0] || { inserted:0, updated:0 };
}

export async function importHigherEdUniverse(maxPages = 8): Promise<ImportResult> {
  const sql=getSql();
  const sourceId=await ensureSource();
  const cp=await checkpoint(sourceId);
  if (cp.complete || !cp.url) return { fetched:0,accepted:0,inserted:0,updated:0,skipped:0,pages:0,totalReported:null,complete:true,resumed:true };

  let url:string|null=cp.url;
  let pages=0,fetched=0,accepted=0,inserted=0,updated=0,skipped=0;
  let totalReported:number|null=null;
  const pageLimit=Math.max(1,Math.min(maxPages,12));

  try {
    while(url && pages<pageLimit){
      const body=await fetchJson(url);
      const rows=Array.isArray(body)?body:Array.isArray(body.results)?body.results:[];
      const next=Array.isArray(body)?null:body.next||null;
      if(!Array.isArray(body)&&Number.isFinite(Number(body.count))) totalReported=Number(body.count);
      pages++; fetched+=rows.length;

      const pageRecords:HigherEdRecord[]=[];
      for(const raw of rows){
        if(!looksActive(raw)){skipped++;continue;}
        const record=pickRecord(raw);
        if(!record){skipped++;continue;}
        pageRecords.push(record);
      }
      const unique=[...new Map(pageRecords.map(r=>[`${r.state}:${r.name.toLowerCase()}`,r])).values()];
      accepted+=unique.length;
      const persisted=await persistBatch(unique);
      inserted+=Number(persisted.inserted||0); updated+=Number(persisted.updated||0);

      url=next;
      await sql.query(`update source_runs set records_seen=coalesce(records_seen,0)+$2::int,records_new=coalesce(records_new,0)+$3::int,records_changed=coalesce(records_changed,0)+$4::int,diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('nextUrl',$5::text,'lastPageFetched',now(),'totalReported',$6::int,'complete',$7::boolean) where id=$1::uuid`,[cp.runId,rows.length,persisted.inserted,persisted.updated,next,totalReported,!next]);
      if(!next) break;
    }
    const complete=!url;
    await sql.query(`update sources set last_success_at=now(),last_error=null,health_score=1 where id=$1::uuid`,[sourceId]);
    if(complete) await sql.query(`update source_runs set status='success',completed_at=now(),diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('complete',true,'nextUrl',null) where id=$1::uuid`,[cp.runId]);
    return {fetched,accepted,inserted,updated,skipped,pages,totalReported,complete,resumed:cp.resumed};
  } catch(error){
    const message=error instanceof Error?error.message:String(error);
    await sql.query(`update sources set last_failure_at=now(),last_error=$2,health_score=greatest(0,coalesce(health_score,1)-0.1) where id=$1::uuid`,[sourceId,message]);
    await sql.query(`update source_runs set error_count=coalesce(error_count,0)+1,diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('lastError',$2::text,'lastErrorAt',now()) where id=$1::uuid`,[cp.runId,message]);
    throw error;
  }
}
