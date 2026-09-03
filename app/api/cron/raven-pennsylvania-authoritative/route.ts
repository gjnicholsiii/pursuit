import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://www.edna.pa.gov/Screens/wfSearchEntityResults.aspx?AUN=&CID=-1&CategoryIDs=1%2C&City=&CurrentName=&HistoricalName=&IU=-1&SchoolBranch=&StatusIDs=1%2C";
const CHECKED = "Authoritative Pennsylvania EdNA school-district directory checked; no matching reachable superintendent for this district in this source.";

type Contact = { district:string; fullName:string; title:string; email:string; phone:string; sourceUrl:string };

function clean(v:string){ return v.replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(area|borough|township|city|county|school|schools|district|sd)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function person(v:string){ return clean(v).replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i,"").replace(/\s*,\s*(acting|substitute|interim)?\s*superintendent.*$/i,"").trim(); }

const EDNA_SEED:Contact[] = [
  {district:"Spring-Ford Area SD",fullName:"Jay Burkhart",title:"Superintendent",email:"",phone:"(610) 705-6220",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26582"},
  {district:"Pen Argyl Area SD",fullName:"Greg Freeman",title:"Superintendent",email:"",phone:"(610) 863-3191 x11312",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26515"},
  {district:"Wilkes-Barre Area SD",fullName:"Brian J Costello",title:"Superintendent",email:"",phone:"(570) 826-7111 x1158",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26470"},
  {district:"Souderton Area SD",fullName:"Christopher D Hey",title:"Superintendent",email:"",phone:"(215) 726-6061 x10200",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26580"},
  {district:"Downingtown Area SD",fullName:"Robert J O'Donnell",title:"Superintendent",email:"",phone:"(610) 269-8460 x11105",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26594"},
  {district:"Williamsport Area SD",fullName:"Timothy Bowers",title:"Superintendent",email:"",phone:"(570) 327-5500 x40510",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26450"},
  {district:"Boyertown Area SD",fullName:"Scott A Davidheiser",title:"Superintendent",email:"",phone:"(610) 369-7548",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26355"},
  {district:"Troy Area SD",fullName:"Bradley R Feldmeier",title:"Superintendent",email:"",phone:"(570) 297-2750 x2201",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26439"},
  {district:"Rochester Area SD",fullName:"Joseph A Guarino",title:"Superintendent",email:"",phone:"(724) 775-7500 x1291",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26687"},
  {district:"Shippensburg Area SD",fullName:"Bill August",title:"Superintendent",email:"",phone:"(717) 530-2700 x1001",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26383"},
  {district:"Saint Clair Area SD",fullName:"Thomas McLaughlin",title:"Superintendent",email:"",phone:"(570) 429-2716",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26714"},
  {district:"Milton Area SD",fullName:"John Bickhart",title:"Superintendent",email:"",phone:"(570) 742-7614",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26421"},
  {district:"State College Area SD",fullName:"Curtis E Johnson",title:"Superintendent",email:"",phone:"(814) 231-1041",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26261"},
  {district:"Parkland SD",fullName:"Mark J Madson",title:"Superintendent",email:"",phone:"(610) 351-5500",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26534"},
  {district:"Reading SD",fullName:"Khalid N Mumin",title:"Superintendent",email:"",phone:"(484) 258-7030",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26367"},
  {district:"Cheltenham SD",fullName:"Christopher McGinley",title:"Acting Superintendent",email:"",phone:"(215) 886-9500 x6301",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26563"},
  {district:"Richland SD",fullName:"Arnold J Nadonley",title:"Superintendent",email:"",phone:"(814) 266-6063",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26218"},
  {district:"Pittsburgh SD",fullName:"Wayne Walters",title:"Superintendent",email:"",phone:"(412) 529-3600",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26026"},
  {district:"Franklin Regional SD",fullName:"Gennaro Piraino",title:"Superintendent",email:"",phone:"(724) 327-5456 x7613",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26173"},
  {district:"Central York SD",fullName:"Peter J Aiken",title:"Superintendent",email:"",phone:"(717) 846-6789 x1200",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26306"},
  {district:"York Suburban SD",fullName:"Scott T Krauser",title:"Superintendent",email:"",phone:"(717) 885-1210 x1121",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26323"},
  {district:"Pottstown SD",fullName:"Stephen Rodriguez",title:"Superintendent",email:"",phone:"(610) 970-6601",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26579"},
  {district:"Centennial SD",fullName:"Abram Lucabaugh",title:"Superintendent",email:"",phone:"(215) 441-6000 x11001",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26544"},
  {district:"East Penn SD",fullName:"Kristen M Campbell",title:"Superintendent",email:"",phone:"(610) 966-8334",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26529"},
  {district:"William Penn SD",fullName:"Eric Becoats",title:"Superintendent",email:"",phone:"(610) 284-8005",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26631"},
  {district:"Susquenita SD",fullName:"Jon D Fox",title:"Superintendent",email:"",phone:"(717) 957-6000 x50001",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26403"},
  {district:"Commodore Perry SD",fullName:"Kenneth C Jewell",title:"Superintendent",email:"",phone:"(724) 253-3255 x1225",sourceUrl:"https://www.edna.pa.gov/Screens/Details/wfAdminDetails.aspx?ID=26105"}
];

async function fetchPage(page:number):Promise<Contact[]> {
  const url = `${BASE}&ctl00_MainContent_grdSearchResultsChangePage=${page}_20`;
  const res = await fetch(url,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/6.1; authoritative-public-directory)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok) throw new Error(`PA EdNA page ${page} HTTP ${res.status}`);
  const $ = cheerio.load(await res.text()); const out:Contact[]=[];
  $("table tr").each((_,tr)=>{ const cells=$(tr).find("th,td").map((__,td)=>clean($(td).text())).get(); if(cells.length<8)return; const district=cells[0]||""; if(!district||!/\bSD\b|School District/i.test(district))return; const phone=cells.find(c=>/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(c))||""; const e=cells.find(validEmail)||""; const admin=cells.find(c=>/superintendent/i.test(c))||""; if(!admin||(!phone&&!e))return; const fullName=person(admin); if(fullName)out.push({district,fullName,title:"Superintendent",email:validEmail(e)?e:"",phone,sourceUrl:url}); });
  return out;
}

async function fetchRoster(){ const all:Contact[]=[]; for(let i=1;i<=25;i+=5){ const settled=await Promise.allSettled([i,i+1,i+2,i+3,i+4].filter(p=>p<=25).map(fetchPage)); for(const s of settled)if(s.status==="fulfilled")all.push(...s.value); } const dedup=new Map<string,Contact>(); for(const c of all)dedup.set(districtKey(c.district),c); return [...dedup.values()]; }

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];

  let fetched:Contact[]=[]; try{fetched=await fetchRoster();}catch{}
  const fullRoster=fetched.length>=100; const roster=fullRoster?fetched:EDNA_SEED;
  const keys=[...new Set(roster.map(r=>districtKey(r.district)).filter(Boolean))];
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='PA' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' order by coalesce(c.updated_at,c.created_at) asc,c.id asc`,[]) as any[];
  const byKey=new Map(roster.map(r=>[districtKey(r.district),r])); let attempted=0,matched=0,filled=0,unmatched=0;
  for(const s of slots){ const ak=districtKey(s.canonical_name||""); const ck=districtKey(s.county||""); let c=byKey.get(ak)||byKey.get(ck); if(!c)c=roster.find(r=>{const rk=districtKey(r.district);return !!rk&&((ak&&ak.includes(rk))||(rk&&ak&&rk.includes(ak)));}); if(!c){ if(fullRoster && keys.some(k=>k===ak||k===ck)){attempted++;unmatched++;} continue; } attempted++; matched++; const u=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=nullif($4,''),phone=nullif($5,''),source_url=$6,verification_status='candidate',evidence_note='Reachable superintendent from official Pennsylvania Department of Education EdNA administrator record; explicit phone or public email published by EdNA; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,c.fullName,c.title,c.email,c.phone,c.sourceUrl]) as any[]; filled+=u.length; }
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const result={ok:true,state:"PA",mode:fullRoster?"live-edna-statewide":"authoritative-edna-seed",liveRosterFetched:fetched.length,seedRecords:EDNA_SEED.length,districtsNewlyAttempted:attempted,matched,filled,unmatched,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}}; console.log("RAVEN_PA_AUTHORITATIVE",result); return NextResponse.json(result);
}
