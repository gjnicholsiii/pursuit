import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LIMIT = 240;
const CONCURRENCY = 24;
const FETCH_TIMEOUT_MS = 7000;
const BANNED = /\b(facilit(?:y|ies)|plant|maintenance|buildings?\s*(?:&|and)\s*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?|transportation|food service|human resources|\bhr\b)\b/i;
const SECURITY = /\b(?:director|chief|executive director|senior director|associate superintendent)\b.{0,80}\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b|\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b.{0,80}\b(?:director|chief|executive director|senior director|associate superintendent)\b/i;
const STRICT: Record<string, RegExp> = {
  state_security_director: SECURITY,
  security_director: SECURITY,
  superintendent: /^((?!assistant|deputy|associate).)*\bsuperintendent\b/i,
  assistant_superintendent: /\b(?:assistant|asst\.?)\s+superintendent\b/i,
  it_director: /\b(?:director|executive director|chief information officer|chief technology officer|cio|cto)\b.{0,60}\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b|\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b.{0,60}\b(?:director|chief information officer|chief technology officer|cio|cto)\b/i,
  school_board: /\b(?:school\s+|governing\s+)?board\s+(?:member|chair|chairman|chairwoman|president|vice president|trustee|clerk)\b|\bboard trustee\b/i,
};
function norm(v:string){return v.toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
async function fetchText(url:string){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),FETCH_TIMEOUT_MS);
  try { const r=await fetch(url,{redirect:"follow",cache:"no-store",signal:c.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven-DirectVerifier/1.0)",accept:"text/html,text/plain;q=0.9"}}); if(!r.ok) return null; const ty=(r.headers.get("content-type")||"").toLowerCase(); if(!ty.includes("html")&&!ty.includes("text")) return null; const body=await r.text(); return norm(cheerio.load(body)("body").text()); } catch { return null; } finally { clearTimeout(t); }
}
export async function GET(req:NextRequest){
  if(req.nextUrl.searchParams.get("key")!=="rvn-bulk-0901") return NextResponse.json({ok:false},{status:404});
  const sql=getSql();
  const rows=await sql.query(`select id::text,role_key,full_name,title,source_url from raven_state_contacts where verification_status='candidate' and full_name is not null and title is not null and source_url is not null order by updated_at asc nulls first,id limit $1`,[LIMIT]) as any[];
  let verified=0,rejected=0,unchanged=0;
  async function one(r:any){
    const rule=STRICT[String(r.role_key)]; const title=String(r.title||"");
    if(!rule||BANNED.test(title)||!rule.test(title)){await sql.query(`update raven_state_contacts set verification_status='rejected',evidence_note='Rejected by strict direct verifier; title outside approved role.',updated_at=now() where id=$1 and verification_status='candidate'`,[r.id]);rejected++;return;}
    const text=await fetchText(String(r.source_url)); if(!text){unchanged++;return;}
    const person=norm(String(r.full_name)); const nt=norm(title);
    if(person.length>=5&&nt.length>=4&&text.includes(person)&&text.includes(nt)){await sql.query(`update raven_state_contacts set verification_status='verified',verified_at=now(),evidence_note='Live official-source verification: exact person and title present.',updated_at=now() where id=$1 and verification_status='candidate'`,[r.id]);verified++;} else unchanged++;
  }
  for(let i=0;i<rows.length;i+=CONCURRENCY) await Promise.all(rows.slice(i,i+CONCURRENCY).map(one));
  const totals=await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected,max(updated_at) latest_update from raven_state_contacts`);
  return NextResponse.json({ok:true,examined:rows.length,verifiedThisRun:verified,rejectedThisRun:rejected,unchangedThisRun:unchanged,totals:totals[0]});
}
