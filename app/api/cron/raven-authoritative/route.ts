import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Contact = { district:string; fullName:string; title:string; email:string; phone:string };
type Source = { state:string; url:string; fetch:()=>Promise<Contact[]>; checkedNote:string };

const TX = "https://tealprod.tea.state.tx.us/Tea.AskTed.Web/Forms/DownloadFile2.aspx";
const TX_CHECKED = "Authoritative Texas TEA AskTED statewide personnel file checked; no matching published reachable contact for this district/role in this source.";
const BATCH_SIZE = 250;

function clean(v:string){ return v.replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function email(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|isd|csd|usd)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

function csvFields(line:string){
  const out:string[]=[]; let cur="",q=false;
  for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){ if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q; } else if(ch===','&&!q){out.push(clean(cur));cur="";} else cur+=ch; }
  out.push(clean(cur)); return out;
}

async function texas(){
  const first=await fetch(TX,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/5.3; authoritative-state-roster)",accept:"text/html,application/xhtml+xml"}});
  if(!first.ok)throw new Error(`Texas AskTED form HTTP ${first.status}`);
  const html=await first.text(); const $=cheerio.load(html); const form=$("form").first(); if(!form.length)throw new Error("Texas AskTED download form not found");
  const body=new URLSearchParams();
  form.find("input[type=hidden]").each((_,el)=>{const n=$(el).attr("name"),v=$(el).attr("value")||"";if(n)body.set(n,v);});
  let superintendentField="";
  form.find("input[type=checkbox]").each((_,el)=>{const n=$(el).attr("name")||"";const id=$(el).attr("id")||"";const context=clean($(el).parent().text()+" "+$(el).closest("tr").text()+" "+$(`label[for='${id}']`).text());if(/superintendent/i.test(context)&&n){superintendentField=n;body.set(n,$(el).attr("value")||"on");}});
  let districtRoleField=""; const roleValues:string[]=[];
  form.find("select").each((_,el)=>{const n=$(el).attr("name")||"";const context=clean($(el).parent().text()+" "+$(el).closest("tr").text());if(/district staff/i.test(context)&&n){districtRoleField=n;$(el).find("option").each((__,op)=>{const text=clean($(op).text());const value=$(op).attr("value")||"";if(value&&/(assistant|associate|deputy superintendent|cybersecurity|police chief|head of security|safe.*supportive|technology|information)/i.test(text))roleValues.push(value);});}else if(/sort by/i.test(context)&&n){const opt=$(el).find("option").filter((__,op)=>!!($(op).attr("value")||"")).first();const v=opt.attr("value");if(v)body.set(n,v);}});
  for(const v of roleValues)body.append(districtRoleField,v);
  let submitName="",submitValue=""; form.find("input[type=submit],button").each((_,el)=>{const n=$(el).attr("name")||"",v=$(el).attr("value")||clean($(el).text());if(!submitName&&/download/i.test(v)&&n){submitName=n;submitValue=v;}}); if(submitName)body.set(submitName,submitValue);
  if(!superintendentField&&!roleValues.length)throw new Error("Texas AskTED personnel controls not resolved");
  const post=await fetch(TX,{method:"POST",cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/5.3; authoritative-state-roster)","content-type":"application/x-www-form-urlencoded","referer":TX,accept:"text/csv,text/plain,application/vnd.ms-excel,*/*"},body:body.toString()});
  if(!post.ok)throw new Error(`Texas AskTED download HTTP ${post.status}`);
  const text=await post.text(); if(/<html|<!doctype/i.test(text.slice(0,500)))throw new Error(`Texas AskTED returned HTML instead of personnel file; superintendentField=${!!superintendentField}; districtRoles=${roleValues.length}`);
  const lines=text.split(/\r?\n/).filter(Boolean); if(lines.length<2)throw new Error("Texas AskTED personnel file empty");
  const delim=lines[0].includes("\t")?"\t":","; const header=(delim==="\t"?lines[0].split("\t"):csvFields(lines[0])).map(x=>x.toLowerCase()); const out:Contact[]=[];
  for(const line of lines.slice(1)){ const c=delim==="\t"?line.split("\t").map(clean):csvFields(line); const find=(rx:RegExp)=>{const i=header.findIndex(h=>rx.test(h));return i>=0?clean(c[i]||""):"";}; const district=find(/district.*name|organization.*name|^district$/); const fullName=person(find(/person.*name|staff.*name|full.*name|contact.*name/)); const title=find(/role|title|position/); const e=find(/email/); const p=find(/phone/); if(district&&fullName&&(email(e)||p)&&/(superintendent|cybersecurity|police chief|head of security|safe.*supportive|technology|information)/i.test(title))out.push({district,fullName,title,email:email(e)?e:"",phone:p}); }
  return [...new Map(out.map(x=>[districtKey(x.district)+"|"+x.title.toLowerCase(),x])).values()];
}

const SOURCES:Source[]=[{state:"TX",url:TX,fetch:texas,checkedNote:TX_CHECKED}];

function roleFor(title:string){ if(/cybersecurity|technology|information/i.test(title))return "it_director"; if(/police chief|head of security|safe.*supportive|security/i.test(title))return "security_director"; if(/assistant|associate|deputy superintendent/i.test(title))return "assistant_superintendent"; return "superintendent"; }
function sameDistrict(slot:any, contact:Contact){ const dk=districtKey(contact.district); const ak=districtKey(slot.canonical_name||""); const ck=districtKey(slot.county||""); return !!dk && (ak===dk||ck===dk||(ak&&ak.includes(dk))||(dk&&ak&&dk.includes(ak))); }

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const results:any[]=[];
  for(const source of SOURCES){
    let roster:Contact[]=[];
    try{ roster=await source.fetch(); }catch(err){ results.push({state:source.state,source:source.url,error:err instanceof Error?err.message:String(err),fetched:0,districtsNewlyAttempted:0,matched:0,filled:0}); continue; }
    const slots=await sql.query(`select c.id::text,c.county,c.role_key,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code=$1 and c.scope='district' and c.verification_status='missing' and coalesce(c.evidence_note,'') <> $2 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $3`,[source.state,source.checkedNote,BATCH_SIZE]) as any[];
    let matched=0,filled=0,unmatched=0;
    for(const s of slots){
      const contact=roster.find(r=>roleFor(r.title)===s.role_key&&sameDistrict(s,r));
      if(contact){
        matched++;
        const u=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=nullif($4,''),phone=nullif($5,''),source_url=$6,verification_status='candidate',evidence_note='Reachable contact ingested directly from authoritative statewide education directory; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,contact.fullName,contact.title,contact.email,contact.phone,source.url]) as any[];
        filled+=u.length;
      }else{
        unmatched++;
        await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,source.checkedNote]);
      }
    }
    const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code=$1 and scope='district' and verification_status='missing' and coalesce(evidence_note,'') <> $2`,[source.state,source.checkedNote]) as any[])[0]?.n||0;
    results.push({state:source.state,source:source.url,fetched:roster.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0});
  }
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,mode:"statewide-authoritative-durable-queue",before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected},sources:results};
  console.log("RAVEN_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
