import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE = "AL";
const ROLE_KEYS = ["security_director","school_board","superintendent","assistant_superintendent","it_director"] as const;

function roleForTitle(titleRaw: string) {
  const title = (titleRaw || "").toLowerCase().replace(/\s+/g," ").trim();
  if (!title) return null;
  if (/facilit|plant|maintenance|buildings?\s*(and|&)\s*grounds|procurement|purchas|finance|financial|principal|teacher|generic operations|operations director|director of operations/.test(title)) return null;
  if (/\b(superintendent)\b/.test(title) && !/assistant|associate|deputy/.test(title)) return "superintendent";
  if (/(assistant|associate|deputy) superintendent/.test(title)) return "assistant_superintendent";
  if (/\b(cio|cto)\b|director.*(information technology|technology|information systems|infrastructure|network services)|chief.*(information|technology)/.test(title)) return "it_director";
  if (/(chief|director|executive director|manager).*(school safety|public safety|security|emergency management)|(school safety|public safety|security|emergency management).*(chief|director|executive director|manager)/.test(title)) return "security_director";
  if (/\b(board member|board chair|board president|board vice president|board trustee|school board member|school board chair|school board president|school board trustee)\b/.test(title)) return "school_board";
  return null;
}

function hostname(urlRaw: string | null) {
  try { return urlRaw ? new URL(urlRaw).hostname.replace(/^www\./,"").toLowerCase() : ""; } catch { return ""; }
}

function sameOfficialHost(sourceUrl: string | null, website: string | null) {
  const a = hostname(sourceUrl), b = hostname(website);
  return !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

function textContainsIdentity(html: string, fullName: string, title: string) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").toLowerCase();
  const name = (fullName || "").toLowerCase().replace(/\s+/g," ").trim();
  if (!name || !text.includes(name)) return false;
  const meaningful = (title || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !["director","assistant","chief","school","county","board"].includes(w));
  return meaningful.length === 0 || meaningful.some(w => text.includes(w));
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  await sql.query(`create table if not exists raven_state_contacts (
    id bigserial primary key,state_code text not null,county text,agency_id bigint references agencies(id) on delete set null,
    scope text not null,role_key text not null,full_name text,title text,email text,phone text,source_url text,
    verification_status text not null default 'missing',verified_at timestamptz,evidence_note text,created_at timestamptz not null default now(),updated_at timestamptz not null default now())`);
  await sql.query(`create unique index if not exists raven_state_contacts_unique_slot on raven_state_contacts(state_code,coalesce(county,''),coalesce(agency_id,0),scope,role_key,coalesce(lower(full_name),''))`);

  const agencies = await sql.query(`select id::text,canonical_name,county,website from agencies where agency_type='k12' and state_code=$1 and county is not null and btrim(county)<>'' and (jurisdiction_level='county' or canonical_name ilike '%county%') order by county,canonical_name`,[STATE]) as any[];

  for (const a of agencies) {
    for (const role of ROLE_KEYS) {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status) values($1,$2,$3,'district',$4,'missing') on conflict do nothing`,[STATE,a.county,a.id,role]);
    }
  }
  await sql.query(`insert into raven_state_contacts(state_code,scope,role_key,verification_status) values($1,'state','state_security_director','missing') on conflict do nothing`,[STATE]);

  const people = await sql.query(`select rp.agency_id::text,rp.full_name,rp.title,rp.email,rp.phone,rp.source_url,a.website,a.county from raven_people rp join agencies a on a.id=rp.agency_id where a.state_code=$1 and a.agency_type='k12' and a.county is not null and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%') and rp.full_name is not null and rp.title is not null`,[STATE]) as any[];

  let candidates = 0, verifiedNow = 0;
  for (const p of people) {
    const role = roleForTitle(p.title);
    if (!role) continue;
    const inserted = await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,evidence_note) values($1,$2,$3,'district',$4,$5,$6,$7,$8,$9,'candidate','Strict title match; awaiting official-source verification') on conflict do nothing returning id::text`,[STATE,p.county,p.agency_id,role,p.full_name,p.title,p.email,p.phone,p.source_url]) as any[];
    if (inserted.length) candidates++;
    if (!p.source_url || !sameOfficialHost(p.source_url,p.website)) continue;
    try {
      const r = await fetch(p.source_url,{headers:{"user-agent":"Mozilla/5.0 RavenContactVerifier/1.0"},redirect:"follow",signal:AbortSignal.timeout(8000)});
      if (!r.ok) continue;
      const html = await r.text();
      if (!textContainsIdentity(html,p.full_name,p.title)) continue;
      const upd = await sql.query(`update raven_state_contacts set verification_status='verified',verified_at=now(),evidence_note='Verified on official school-system source',updated_at=now() where state_code=$1 and agency_id=$2 and role_key=$3 and lower(full_name)=lower($4) and verification_status<>'verified' returning id`,[STATE,p.agency_id,role,p.full_name]) as any[];
      verifiedNow += upd.length;
    } catch {}
  }

  // Collapse empty placeholder rows when a real candidate/verified contact exists for that exact role slot.
  await sql.query(`delete from raven_state_contacts x where x.state_code=$1 and x.full_name is null and exists(select 1 from raven_state_contacts y where y.state_code=x.state_code and coalesce(y.county,'')=coalesce(x.county,'') and coalesce(y.agency_id,0)=coalesce(x.agency_id,0) and y.role_key=x.role_key and y.full_name is not null)`,[STATE]);

  const stats = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code=$1`,[STATE]) as any[];
  const countyStats = await sql.query(`select county,count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code=$1 and county is not null group by county order by county`,[STATE]) as any[];
  const incomplete = countyStats.filter((r:any)=>Number(r.missing)>0 || Number(r.candidate)>0);
  const complete = incomplete.length===0 && Number(stats[0]?.missing||0)===0 && Number(stats[0]?.candidate||0)===0;
  const snapshot={state:STATE,agencies:agencies.length,candidatesAdded:candidates,verifiedNow,...stats[0],complete,incompleteCounties:incomplete.map((r:any)=>({county:r.county,verified:Number(r.verified),candidate:Number(r.candidate),missing:Number(r.missing)}))};
  console.log("RAVEN_STATE_BUILD",JSON.stringify(snapshot));
  return NextResponse.json({ok:true,...snapshot});
}
