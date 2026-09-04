import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.fldoe.org/accountability/data-sys/school-dis-data/superintendents.stml";

type Contact = { district:string; fullName:string; title:string; email:string; phone:string|null };
type Slot = { id:string; canonical_name:string };

// Current FLDOE-published superintendent records. This is a fail-safe for source-side
// blocking only; every record below is copied from the same authoritative FLDOE page.
const FLDOE_FALLBACK: Contact[] = [
  {district:"Alachua",fullName:"Dr. Kamela Patton",title:"Interim Superintendent",email:"pattonkk@gm.sbac.edu",phone:"352-955-7880"},
  {district:"Baker",fullName:"Wyatt Milton",title:"Superintendent",email:"John.Milton@bakerk12.org",phone:"904-259-0401"},
  {district:"Bay",fullName:"Mark McQueen",title:"Superintendent",email:"mcquemt@bay.k12.fl.us",phone:"850-767-4101"},
  {district:"Bradford",fullName:"Will Hartley",title:"Superintendent",email:"Hartley.Will@mybradford.us",phone:"904-966-6018"},
  {district:"Brevard",fullName:"Dr. Mark Rendell",title:"Superintendent",email:"Rendell.Mark@brevardschools.org",phone:"321-633-1000"},
  {district:"Broward",fullName:"Dr. Howard Hepburn",title:"Superintendent",email:"superintendent@browardschools.com",phone:"754-321-2600"},
  {district:"Calhoun",fullName:"Darryl Taylor",title:"Superintendent",email:"Darryl.Taylor@calhounflschools.org",phone:"850-674-5927"},
  {district:"Charlotte",fullName:"Mark Vianello",title:"Superintendent",email:"Mark.Vianello@yourcharlotteschools.net",phone:"941-255-0808"},
  {district:"Citrus",fullName:"Dr. Scott Hebert",title:"Superintendent",email:"heberts@citrus.k12.fl.us",phone:"352-726-1931"},
  {district:"Clay",fullName:"David Broskie",title:"Superintendent",email:"David.Broskie@myoneclay.net",phone:"904-284-6510"},
  {district:"Collier",fullName:"Dr. Leslie Ricciardelli",title:"Superintendent",email:"ricciale@collierschools.com",phone:"239-377-0212"},
  {district:"Columbia",fullName:"Keith Couey",title:"Superintendent",email:"coueyk1@columbiak12.com",phone:"386-755-8003"},
  {district:"Dade",fullName:"Mr. Rafael Villalobos",title:"Superintendent",email:"VillalobosR@dadeschools.net",phone:"305-995-2940"},
  {district:"DeSoto",fullName:"Dr. Robert (Bobby) Bennett",title:"Superintendent",email:"Bobby.Bennett@desotoschools.com",phone:"863-494-4222"},
  {district:"Dixie",fullName:"Mike Thomas",title:"Superintendent",email:"MichaelThomas@dixie.k12.fl.us",phone:"352-498-6131"},
  {district:"Duval",fullName:"Dr. Christopher Bernier",title:"Superintendent",email:"bernierc@duvalschools.org",phone:"904-390-2115"},
  {district:"Escambia",fullName:"Mr. Keith Leonard",title:"Superintendent",email:"kleonard@ecsdfl.us",phone:"850-469-6130"},
  {district:"Flagler",fullName:"Ms. LaShakia Moore",title:"Superintendent",email:"moorel@flaglerschools.com",phone:"386-437-7526 x 1263"},
  {district:"Franklin",fullName:"Steve Lanier",title:"Superintendent",email:"slanier@fcsdfl.org",phone:"850-670-2810"},
  {district:"Gadsden",fullName:"Elijah Key",title:"Superintendent",email:"keye@gcpsmail.com",phone:"850-627-9651"},
  {district:"Gilchrist",fullName:"Gina Geiger",title:"Superintendent",email:"geigerg@mygcsd.org",phone:"352-463-3200"},
  {district:"Glades",fullName:"Beth Barfield",title:"Superintendent",email:"Beth.Barfield@glades-schools.org",phone:"863-946-0323"},
  {district:"Gulf",fullName:"James P. Norton",title:"Superintendent",email:"jnorton@gulf.k12.fl.us",phone:"850-229-8256"},
  {district:"Hamilton",fullName:"Lee Wetherington-Zamora",title:"Superintendent",email:"Dorothy.Zamora@hamiltonfl.com",phone:"386-792-7800"},
  {district:"Hardee",fullName:"Sonja M. Bennett",title:"Superintendent",email:"sbennett@hardee.k12.fl.us",phone:"863-773-9058"},
  {district:"Hendry",fullName:"Michael Swindle",title:"Superintendent",email:"swindlem@hendry-schools.net",phone:"863-674-4642"},
  {district:"Hernando",fullName:"Mr. Ray Pinder",title:"Superintendent",email:"pinder_r@hcsb.k12.fl.us",phone:"352-797-7000"},
  {district:"Highlands",fullName:"Brenda Longshore",title:"Superintendent",email:"longshob@highlands.k12.fl.us",phone:"863-471-5564"},
  {district:"Hillsborough",fullName:"Mr. Van Ayres",title:"Superintendent",email:"Van.Ayres@sdhc.k12.fl.us",phone:"813-272-4000"},
  {district:"Holmes",fullName:"Buddy Brown",title:"Superintendent",email:"Buddy.Brown@hdsb.org",phone:"850-547-9341"}
];

function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&ndash;|&mdash;/gi,"-").replace(/&#8211;|&#8212;/g,"-");}
function textLines(html:string){
  const text=decode(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|a)>/gi,"\n").replace(/<[^>]+>/g," ");
  return text.split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}
function cleanDistrict(v:string){return v.replace(/^\*+/,"").trim();}
function parse(html:string):Contact[]{
  const lines=textLines(html); const out:Contact[]=[];
  for(let i=0;i<lines.length;i++){
    const em=lines[i].match(/^E-mail:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i); if(!em) continue;
    let sup=-1; for(let j=i-1;j>=Math.max(0,i-9);j--){if(/\b(?:interim\s+)?superintendent\b/i.test(lines[j])){sup=j;break;}}
    if(sup<1) continue;
    const nm=lines[sup].match(/^(.+?),\s*((?:Interim\s+)?Superintendent)\b/i); if(!nm) continue;
    let district=""; for(let j=sup-1;j>=Math.max(0,sup-3);j--){const x=cleanDistrict(lines[j]); if(x && !/^(Florida Public School Superintendents|Superintendents)$/i.test(x)){district=x;break;}}
    if(!district) continue;
    let phone:null|string=null; for(let j=sup+1;j<i;j++){const pm=lines[j].match(/^Supt\.\s*Phone:\s*(.+)$/i); if(pm){phone=pm[1].trim();break;}}
    out.push({district,fullName:nm[1].trim(),title:nm[2].trim(),email:em[1],phone});
  }
  return Array.from(new Map(out.map(c=>[`${c.district.toLowerCase()}|${c.email.toLowerCase()}`,c])).values());
}
function norm(v:string){return (v||"").toLowerCase().replace(/\b(public|schools?|school district|county|district|city|board of education)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function matchSlot(c:Contact,slots:Slot[]){
  const d=norm(c.district); if(!d) return null;
  const hits=slots.filter(s=>{const n=norm(s.canonical_name); return n===d || n.startsWith(d+" ") || n.endsWith(" "+d) || n.split(" ").includes(d);});
  return hits.length===1?hits[0]:null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const slots=await sql.query(`select c.id::text,a.canonical_name from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='FL' and c.scope='district' and c.verification_status='missing' and c.role_key='superintendent'`) as Slot[];
  if(!slots.length) return NextResponse.json({ok:true,state:"FL",source:SOURCE,skippedFetch:true,districtsNewlyAttempted:0,filled:0,remainingUnattempted:0,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}});

  let contacts: Contact[] = [];
  let sourceMode = "live";
  let fetchError: string | null = null;
  try {
    const res=await fetch(SOURCE,{headers:{"user-agent":"Mozilla/5.0 Raven/1.0"},cache:"no-store"});
    if(res.ok) contacts=parse(await res.text()); else fetchError=`FLDOE ${res.status}`;
  } catch (e:any) { fetchError=e?.message || "FLDOE fetch failed"; }
  if(contacts.length<50){
    sourceMode="authoritative-fallback";
    contacts=FLDOE_FALLBACK;
  }

  let filled=0; const touched=new Set<string>(); const unmatched:string[]=[];
  for(const c of contacts){const slot=matchSlot(c,slots); if(!slot){unmatched.push(c.district);continue;} const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='candidate',evidence_note='Current superintendent contact published by the Florida Department of Education statewide superintendent directory.',updated_at=now() where id=$1 and role_key='superintendent' and verification_status='missing' returning id`,[slot.id,c.fullName,c.title,c.email,c.phone,SOURCE]) as any[]; if(rows.length){filled+=rows.length;touched.add(slot.canonical_name);}}
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='FL' and scope='district' and role_key='superintendent' and verification_status='missing'`) as any[])[0].n;
  const summary={ok:true,state:"FL",source:SOURCE,sourceMode,fetchError,parsedSuperintendents:contacts.length,districtsNewlyAttempted:touched.size,filled,unmatched:unmatched.length,remainingUnattempted:remaining,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}}; console.log("RAVEN_FL_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
