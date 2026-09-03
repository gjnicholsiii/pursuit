import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Contact = {
  district: string;
  role: "superintendent" | "assistant_superintendent" | "it_director" | "school_board";
  fullName: string;
  title: string;
  email?: string;
  phone?: string;
  sourceUrl: string;
};

const CONTACTS: Contact[] = [
  {district:"Crawford County",role:"superintendent",fullName:"Anthony Aikens",title:"Superintendent",email:"anthony.aikens@crawfordschools.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Carroll County",role:"superintendent",fullName:"Jessica Ainsworth",title:"Superintendent",email:"Jessica.ainsworth@carrollcountyschools.com",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Carrollton City",role:"superintendent",fullName:"Mark Albertus",title:"Superintendent",email:"mark.albertus@carrolltoncityschools.net",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Ware County",role:"superintendent",fullName:"Lynn Barber",title:"Superintendent",email:"lbarber@ware.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Twiggs County",role:"superintendent",fullName:"Tyrone Bacon",title:"Interim Superintendent",email:"tbacon@twiggs.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Putnam County",role:"superintendent",fullName:"Derick Austin",title:"Superintendent",email:"derick_austin@putnam.k12.ga.us",phone:"706-485-5381",sourceUrl:"https://www.putnam.k12.ga.us/page/superintendent"},
  {district:"Paulding County",role:"superintendent",fullName:"Steve Barnette",title:"Superintendent",email:"sbarnette@paulding.k12.ga.us",phone:"770-443-8000",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Irwin County",role:"superintendent",fullName:"Kerry Billingsley",title:"Superintendent",email:"kbillingsley@irwin.k12.ga.us",phone:"229-468-7485",sourceUrl:"https://www.irwin.k12.ga.us/staff"},
  {district:"Glynn County",role:"superintendent",fullName:"Mike Blackerby",title:"Superintendent",email:"mike.blackerby@glynn.k12.ga.us",phone:"912-267-4100",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Jasper County",role:"superintendent",fullName:"Tracy Blackburn",title:"Superintendent",email:"tblackburn@jasper.k12.ga.us",phone:"706-468-6350",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Haralson County",role:"superintendent",fullName:"Jerry Bell",title:"Superintendent",email:"jerry.bell@haralson.k12.ga.us",phone:"770-574-2500",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Pierce County",role:"superintendent",fullName:"Dara Bennett",title:"Superintendent",email:"dbennett@pierce.k12.ga.us",phone:"912-449-2044",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Towns County",role:"superintendent",fullName:"Darren Berrong",title:"Superintendent",email:"dberrong@towns.k12.ga.us",phone:"706-896-2279",sourceUrl:"https://www.gssaweb.org/superintendents/"},

  {district:"Crawford County",role:"it_director",fullName:"Carmen J. Wilson Sr.",title:"Director of Technology",phone:"478-836-3131 x5016",sourceUrl:"https://www.crawfordschools.org/page/staff-professional-learning"},
  {district:"Carrollton City",role:"it_director",fullName:"Jared Price",title:"Director of Information Technology",email:"jared.price@carrolltoncityschools.net",phone:"770-832-9633",sourceUrl:"https://www.carrolltoncityschools.net/departments/technology"},
  {district:"Twiggs County",role:"it_director",fullName:"TraVontae Basley",title:"Technology Director",phone:"478-945-3127",sourceUrl:"https://www.twiggs.k12.ga.us/departments/technology-department/index"},
  {district:"Putnam County",role:"it_director",fullName:"Ryan Rogers",title:"Technology Director",phone:"706-485-5381",sourceUrl:"https://www.putnam.k12.ga.us/staff"},
  {district:"Jasper County",role:"it_director",fullName:"Cara Bockholt",title:"Director of Technology",email:"cbockholt@jasper.k12.ga.us",phone:"706-468-6350 x5120",sourceUrl:"https://www.jasper.k12.ga.us/departments/technology"},
  {district:"Paulding County",role:"it_director",fullName:"Julie Ragsdale",title:"Chief Information Officer",phone:"770-443-8000",sourceUrl:"https://www.paulding.k12.ga.us/departments/technology-division/index"},
  {district:"Haralson County",role:"it_director",fullName:"Wayne Brooks",title:"Interim Chief Technology Officer",phone:"770-574-2500",sourceUrl:"https://www.haralson.k12.ga.us/ContactUs.aspx"},

  {district:"Irwin County",role:"assistant_superintendent",fullName:"Candice Cobb",title:"Assistant Superintendent",email:"ccobb@irwin.k12.ga.us",phone:"229-468-7485",sourceUrl:"https://www.irwin.k12.ga.us/staff"},
  {district:"Putnam County",role:"assistant_superintendent",fullName:"Scott Sauls",title:"Assistant Superintendent",phone:"706-485-5381",sourceUrl:"https://www.putnam.k12.ga.us/staff"},
  {district:"Carrollton City",role:"assistant_superintendent",fullName:"Craig George",title:"Assistant Superintendent Facilities & Operations",email:"Craig.george@carrolltoncityschools.net",phone:"770-832-9633",sourceUrl:"https://www.carrolltoncityschools.net/departments/administration"},

  {district:"Crawford County",role:"school_board",fullName:"Jackson DeFore",title:"Board Chairman",email:"jacksondefore@gmail.com",phone:"478-836-3131",sourceUrl:"https://www.crawfordschools.org/page/staff"}
];

function key(v:string){
  return (v||"").toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|charter|school|schools|system|district)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];

  const slots=await sql.query(`select c.id::text,c.role_key,a.canonical_name from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='GA' and c.scope='district' and c.verification_status='missing' and c.role_key in ('superintendent','assistant_superintendent','it_director','school_board')`) as any[];

  let attempted=0, matched=0, filled=0;
  const touchedDistricts=new Set<string>();
  for(const contact of CONTACTS){
    if(!contact.email && !contact.phone) continue;
    const slot=slots.find((s:any)=>s.role_key===contact.role && key(s.canonical_name)===key(contact.district));
    if(!slot) continue;
    attempted++;
    touchedDistricts.add(contact.district);
    matched++;
    const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='candidate',evidence_note='Reachable Georgia school official published by GSSA or the district official directory; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[slot.id,contact.fullName,contact.title,contact.email||null,contact.phone||null,contact.sourceUrl]) as any[];
    filled+=rows.length;
  }

  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"GA",source:"GSSA + official district directories",seedRecords:CONTACTS.length,districtsNewlyAttempted:touchedDistricts.size,slotsNewlyAttempted:attempted,matched,filled,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_GA_AUTHORITATIVE",summary);
  return NextResponse.json(summary);
}
