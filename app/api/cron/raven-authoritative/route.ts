import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Contact = { district:string; fullName:string; title:string; email:string; phone:string };
type Source = { state:string; url:string; fetch:()=>Promise<Contact[]>; checkedNote:string };
type Match = { id:string; fullName:string; title:string; email:string; phone:string; sourceUrl:string };

const TX = "https://tealprod.tea.state.tx.us/Tea.AskTed.Web/Forms/DownloadFile2.aspx";
const TX_CHECKED = "Authoritative Texas TEA AskTED statewide personnel file checked; no matching published contact for this district/role in this source.";
const TX_BOARD = "https://tealprod.tea.state.tx.us/Tea.AskTed.Web/Content/TSDFiles/TSD-2026-partial.xlsx";
const TX_BOARD_CHECKED = "Authoritative Texas Education Agency 2025-2026 Texas School Directory Board of Trustee Members roster checked; no matching published board member for this district in this source.";
const UT = "https://schools.utah.gov/schooldistricts";
const UT_CHECKED = "Authoritative Utah State Board of Education statewide district directory checked; no matching published superintendent for this district in this source.";

function clean(v:string){ return (v||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function email(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function plausiblePerson(v:string){
  const x=person(v);
  return x.length>=5 && x.length<=90 && /^[A-Za-zÀ-ÖØ-öø-ÿ.' -]+$/.test(x) && x.trim().split(/\s+/).length>=2;
}
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|isd|csd|usd|charter|academy|union|unified|elementary|high)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function csvFields(line:string){
  const out:string[]=[]; let cur="",q=false;
  for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){ if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q; } else if(ch===','&&!q){out.push(clean(cur));cur="";} else cur+=ch; }
  out.push(clean(cur)); return out;
}

async function texas(){
  const first=await fetch(TX,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/7.0; statewide-authoritative)",accept:"text/html,application/xhtml+xml"}});
  if(!first.ok)throw new Error(`Texas AskTED form HTTP ${first.status}`);
  const html=await first.text(); const $=cheerio.load(html); const form=$("form").first();
  if(!form.length)throw new Error("Texas AskTED download form not found");
  const body=new URLSearchParams();
  form.find("input[type=hidden]").each((_,el)=>{const n=$(el).attr("name"),v=$(el).attr("value")||"";if(n)body.set(n,v);});
  let superintendentField="";
  form.find("input[type=checkbox]").each((_,el)=>{const n=$(el).attr("name")||"";const id=$(el).attr("id")||"";const context=clean($(el).parent().text()+" "+$(el).closest("tr").text()+" "+$(`label[for='${id}']`).text());if(/superintendent/i.test(context)&&n){superintendentField=n;body.set(n,$(el).attr("value")||"on");}});
  let districtRoleField=""; const roleValues:string[]=[];
  form.find("select").each((_,el)=>{const n=$(el).attr("name")||"";const context=clean($(el).parent().text()+" "+$(el).closest("tr").text());if(/district staff/i.test(context)&&n){districtRoleField=n;$(el).find("option").each((__,op)=>{const text=clean($(op).text());const value=$(op).attr("value")||"";if(value&&/(assistant|associate|deputy superintendent|cybersecurity|police chief|head of security|safe.*supportive|technology|information)/i.test(text))roleValues.push(value);});}else if(/sort by/i.test(context)&&n){const opt=$(el).find("option").filter((__,op)=>!!($(op).attr("value")||"")).first();const v=opt.attr("value");if(v)body.set(n,v);}});
  for(const v of roleValues)body.append(districtRoleField,v);
  let submitName="",submitValue="";
  form.find("input[type=submit],button").each((_,el)=>{const n=$(el).attr("name")||"",v=$(el).attr("value")||clean($(el).text());if(!submitName&&/download/i.test(v)&&n){submitName=n;submitValue=v;}});
  if(submitName)body.set(submitName,submitValue);
  if(!superintendentField&&!roleValues.length)throw new Error("Texas AskTED personnel controls not resolved");
  const post=await fetch(TX,{method:"POST",cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/7.0; statewide-authoritative)","content-type":"application/x-www-form-urlencoded","referer":TX,accept:"text/csv,text/plain,application/vnd.ms-excel,*/*"},body:body.toString()});
  if(!post.ok)throw new Error(`Texas AskTED download HTTP ${post.status}`);
  const text=await post.text();
  if(/<html|<!doctype/i.test(text.slice(0,500)))throw new Error("Texas AskTED returned HTML instead of personnel file");
  const lines=text.split(/\r?\n/).filter(Boolean); if(lines.length<2)throw new Error("Texas AskTED personnel file empty");
  const delim=lines[0].includes("\t")?"\t":",";
  const header=(delim==="\t"?lines[0].split("\t"):csvFields(lines[0])).map(x=>x.toLowerCase());
  const out:Contact[]=[];
  for(const line of lines.slice(1)){
    const c=delim==="\t"?line.split("\t").map(clean):csvFields(line);
    const find=(rx:RegExp)=>{const i=header.findIndex(h=>rx.test(h));return i>=0?clean(c[i]||""):"";};
    const district=find(/district.*name|organization.*name|^district$/);
    const fullName=person(find(/person.*name|staff.*name|full.*name|contact.*name/));
    const title=find(/role|title|position/); const e=find(/email/); const p=find(/phone/);
    if(district&&plausiblePerson(fullName)&&(email(e)||p)&&/(superintendent|cybersecurity|police chief|head of security|safe.*supportive|technology|information)/i.test(title))out.push({district,fullName,title,email:email(e)?e:"",phone:p});
  }
  return [...new Map(out.map(x=>[districtKey(x.district)+"|"+roleFor(x.title),x])).values()];
}

async function texasBoards(){
  const res=await fetch(TX_BOARD,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/7.0; statewide-board-roster)",accept:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*"}});
  if(!res.ok)throw new Error(`Texas TEA school directory workbook HTTP ${res.status}`);
  const wb=XLSX.read(new Uint8Array(await res.arrayBuffer()),{type:"array"});
  const sheetName=wb.SheetNames.find(n=>/board.*trustee|trustee.*member|board.*member/i.test(n));
  if(!sheetName)throw new Error(`Texas TEA workbook missing Board of Trustee Members sheet; sheets=${wb.SheetNames.join("|")}`);
  const rows=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName],{header:1,defval:"",raw:false}).map(r=>r.map(v=>clean(String(v??""))));
  let headerAt=-1,districtCol=-1,nameCol=-1,titleCol=-1,emailCol=-1,phoneCol=-1;
  for(let i=0;i<Math.min(rows.length,30);i++){
    const r=rows[i].map(v=>v.toLowerCase()); const d=r.findIndex(v=>/district|charter|organization/.test(v)); const n=r.findIndex(v=>/trustee.*name|member.*name|board.*member|full.*name|^name$/.test(v));
    if(d>=0&&n>=0){headerAt=i;districtCol=d;nameCol=n;titleCol=r.findIndex(v=>/title|office|position|role/.test(v));emailCol=r.findIndex(v=>/email/.test(v));phoneCol=r.findIndex(v=>/phone|telephone/.test(v));break;}
  }
  if(headerAt<0)throw new Error("Texas TEA board sheet header not resolved");
  const out:Contact[]=[];
  for(const r of rows.slice(headerAt+1)){
    const district=clean(r[districtCol]||""); const fullName=person(r[nameCol]||""); const title=clean(titleCol>=0?(r[titleCol]||""):"")||"Board Trustee"; const e=clean(emailCol>=0?(r[emailCol]||""):""); const p=clean(phoneCol>=0?(r[phoneCol]||""):"");
    if(district&&plausiblePerson(fullName))out.push({district,fullName,title,email:email(e)?e:"",phone:p});
  }
  if(out.length<100)throw new Error(`Texas TEA board roster confidence guard: only ${out.length} board rows parsed`);
  const priority=(t:string)=>/president|chair/i.test(t)?0:/vice/i.test(t)?1:/secretary/i.test(t)?2:3;
  const best=new Map<string,Contact>();
  for(const c of out){const k=districtKey(c.district);const prior=best.get(k);if(!prior||priority(c.title)<priority(prior.title))best.set(k,c);}
  return [...best.values()];
}

async function utah(){
  const res=await fetch(UT,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/7.0; statewide-authoritative)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok)throw new Error(`Utah USBE directory HTTP ${res.status}`);
  const $=cheerio.load(await res.text()); const out:Contact[]=[];
  $("table tr").each((_,tr)=>{const cells=$(tr).find("th,td").map((__,td)=>clean($(td).text())).get();if(cells.length<10)return;if(/district/i.test(cells[0]||"")&&/superintendent/i.test(cells.join(" ")))return;const district=cells[0]||"";let fullName="",e="",phone="";for(const cell of cells){if(!e&&email(cell))e=cell;if(!phone&&/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(cell))phone=cell;}const emailIndex=cells.findIndex(email);if(emailIndex>0){for(let i=emailIndex-1;i>=0;i--){const v=person(cells[i]||"");if(v&&v!==district&&!/^(ut|utah)$/i.test(v)&&!/^\d/.test(v)){fullName=v;break;}}}if(!fullName){const likely=cells.find((v,i)=>i>0&&i<14&&/[A-Za-z]+\s+[A-Za-z]+/.test(v)&&!/(street|road|avenue|city|district|school)/i.test(v));fullName=person(likely||"");}if(district&&plausiblePerson(fullName)&&(e||phone))out.push({district,fullName,title:"Superintendent",email:e,phone});});
  return [...new Map(out.map(x=>[districtKey(x.district),x])).values()];
}

const SOURCES:Source[]=[
  {state:"TX",url:TX,fetch:texas,checkedNote:TX_CHECKED},
  {state:"TX",url:TX_BOARD,fetch:texasBoards,checkedNote:TX_BOARD_CHECKED},
  {state:"UT",url:UT,fetch:utah,checkedNote:UT_CHECKED}
];

function roleFor(title:string){
  if(/board|trustee/i.test(title))return "school_board";
  if(/cybersecurity|technology|information/i.test(title))return "it_director";
  if(/police chief|head of security|safe.*supportive|security/i.test(title))return "security_director";
  if(/assistant|associate|deputy superintendent/i.test(title))return "assistant_superintendent";
  return "superintendent";
}

function slotKey(slot:any){return districtKey(slot.canonical_name||slot.county||"")+"|"+slot.role_key;}
function contactKey(c:Contact){return districtKey(c.district)+"|"+roleFor(c.title);}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const results:any[]=[];

  for(const source of SOURCES){
    let roster:Contact[]=[];
    try{roster=await source.fetch();}
    catch(err){results.push({state:source.state,source:source.url,error:err instanceof Error?err.message:String(err),fetched:0,processed:0,matched:0,filled:0});continue;}

    const supportedRoles=[...new Set(roster.map(r=>roleFor(r.title)))];
    const slots=(await sql.query(`select c.id::text,c.county,c.role_key,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code=$1 and c.scope='district' and c.verification_status='missing' and c.role_key = any($2::text[])`,[source.state,supportedRoles])) as any[];
    const byKey=new Map(roster.map(c=>[contactKey(c),c]));
    const matches:Match[]=[]; const unmatched:string[]=[];

    for(const s of slots){
      const c=byKey.get(slotKey(s));
      if(c&&plausiblePerson(c.fullName)) matches.push({id:s.id,fullName:c.fullName,title:c.title,email:c.email,phone:c.phone,sourceUrl:source.url});
      else unmatched.push(s.id);
    }

    let filled=0;
    if(matches.length){
      const updated=await sql.query(`
        with incoming as (
          select * from jsonb_to_recordset($1::jsonb) as x(id bigint, full_name text, title text, email text, phone text, source_url text)
        )
        update raven_state_contacts c
        set full_name=i.full_name,
            title=i.title,
            email=nullif(i.email,''),
            phone=nullif(i.phone,''),
            source_url=i.source_url,
            verification_status='verified',
            verified_at=now(),
            evidence_note='Verified directly from an authoritative statewide education roster; exact district and approved leadership role matched in bulk.',
            updated_at=now()
        from incoming i
        where c.id=i.id and c.verification_status='missing'
        returning c.id
      `,[JSON.stringify(matches)]) as any[];
      filled=updated.length;
    }

    if(unmatched.length){
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id = any($1::bigint[]) and verification_status='missing'`,[unmatched,source.checkedNote]);
    }

    results.push({state:source.state,source:source.url,fetched:roster.length,supportedRoles,processed:slots.length,matched:matches.length,filled,unmatched:unmatched.length});
  }

  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,mode:"statewide-authoritative-v2-full-state-set-based",before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected},sources:results};
  console.log("RAVEN_AUTHORITATIVE_V2",summary);
  return NextResponse.json(summary);
}
