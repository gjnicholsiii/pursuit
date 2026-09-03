import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Contact = {
  district: string;
  fullName: string;
  title: string;
  email?: string;
  phone?: string;
  sourceUrl: string;
};

// Superintendent-only acquisition. Do not add IT, principals, security,
// assistant superintendents, boards, or any other school role here.
const CONTACTS: Contact[] = [
  {district:"Crawford County",fullName:"Anthony Aikens",title:"Superintendent",email:"anthony.aikens@crawfordschools.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Carroll County",fullName:"Jessica Ainsworth",title:"Superintendent",email:"Jessica.ainsworth@carrollcountyschools.com",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Carrollton City",fullName:"Mark Albertus",title:"Superintendent",email:"mark.albertus@carrolltoncityschools.net",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Ware County",fullName:"Lynn Barber",title:"Superintendent",email:"lbarber@ware.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Twiggs County",fullName:"Tyrone Bacon",title:"Interim Superintendent",email:"tbacon@twiggs.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Putnam County",fullName:"Derick Austin",title:"Superintendent",email:"derick_austin@putnam.k12.ga.us",phone:"706-485-5381",sourceUrl:"https://www.putnam.k12.ga.us/page/superintendent"},
  {district:"Paulding County",fullName:"Steve Barnette",title:"Superintendent",email:"sbarnette@paulding.k12.ga.us",phone:"770-443-8000",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Irwin County",fullName:"Kerry Billingsley",title:"Superintendent",email:"kbillingsley@irwin.k12.ga.us",phone:"229-468-7485",sourceUrl:"https://www.irwin.k12.ga.us/staff"},
  {district:"Glynn County",fullName:"Mike Blackerby",title:"Superintendent",email:"mike.blackerby@glynn.k12.ga.us",phone:"912-267-4100",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Jasper County",fullName:"Tracy Blackburn",title:"Superintendent",email:"tblackburn@jasper.k12.ga.us",phone:"706-468-6350",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Haralson County",fullName:"Jerry Bell",title:"Superintendent",email:"jerry.bell@haralson.k12.ga.us",phone:"770-574-2500",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Pierce County",fullName:"Dara Bennett",title:"Superintendent",email:"dbennett@pierce.k12.ga.us",phone:"912-449-2044",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Towns County",fullName:"Darren Berrong",title:"Superintendent",email:"dberrong@towns.k12.ga.us",phone:"706-896-2279",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Harris County",fullName:"Michael Barden",title:"Superintendent",email:"barden-m@harris.k12.ga.us",phone:"706-628-4206",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Bleckley County",fullName:"Trey Belflower",title:"Superintendent",email:"treyb@bleckleyschools.org",phone:"478-230-2871",sourceUrl:"https://bleckleyschools.org/apps/pages/index.jsp?type=d&uREC_ID=370818"},
  {district:"Mitchell County",fullName:"Veronica Brown",title:"Superintendent",email:"veronica_brown@mitchell.k12.ga.us",phone:"229-321-7002",sourceUrl:"https://www.mitchell.k12.ga.us/apps/staff/"},
  {district:"Baker County",fullName:"Roy Brooks",title:"Superintendent",email:"rbrooks@baker.k12.ga.us",phone:"229-734-5274",sourceUrl:"https://www.baker.k12.ga.us/apps/pages/index.jsp?pREC_ID=2388058&type=d&uREC_ID=3445655"},
  {district:"Taylor County",fullName:"Jennifer Albritton",title:"Superintendent",email:"albritton.jennifer@taylorboe.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Wheeler County",fullName:"Alex Alvarez",title:"Superintendent",email:"alex.alvarez@wheeler.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Evans County",fullName:"Bradley Anderson",title:"Interim Superintendent",email:"BradleyAnderson@evanscountyschools.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Newton County",fullName:"Duke Bradley",title:"Superintendent",email:"bradley.duke@newton.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Baldwin County",fullName:"Kristie Brooks",title:"Superintendent",email:"kristina.brooks@baldwin.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Dodge County",fullName:"Wade Burnette",title:"Superintendent",email:"wade.burnette@dodge.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Franklin County",fullName:"Melanie Burton-Brown",title:"Superintendent",email:"melanie.burton-brown@franklin.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Oconee County",fullName:"Melissa Butler",title:"Superintendent",email:"mbutler@oconeeschools.org",phone:"706-769-5130",sourceUrl:"https://www.oconeeschools.org/board/superintendent/superintendents-office"},
  {district:"Schley County",fullName:"Harley Calhoun",title:"Superintendent",email:"hcalhoun@schleyk12.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Hart County",fullName:"Jennifer Carter",title:"Superintendent",email:"jcarter@hart.k12.ga.us",phone:"706-376-5141",sourceUrl:"https://www.hart.k12.ga.us/departments/superintendent/about-the-superintendent"},
  {district:"Buford City",fullName:"Amy Chafin",title:"Superintendent",email:"amy.chafin@bufordcityschools.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Colquitt County",fullName:"Dan Chappuis",title:"Superintendent",email:"daniel.chappuis@colquitt.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Bremen City",fullName:"Shannon Christian",title:"Superintendent",email:"shannon.christian@bremencs.com",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Richmond County",fullName:"Malinda Cobb",title:"Superintendent",email:"cobbma@boe.richmond.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Rabun County",fullName:"Steven Cole",title:"Superintendent",email:"scole@rabuncountyschools.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Dalton City",fullName:"Steven Craft",title:"Superintendent",email:"steven.craft@dalton.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Long County",fullName:"Heath Crane",title:"Superintendent",email:"hcrane@longcountyschools.org",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Lanier County",fullName:"Brooks Culpepper",title:"Superintendent",email:"gene.culpepper@lanier.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Worth County",fullName:"Nehemiah Cummings",title:"Superintendent",email:"ncummings@worthschools.net",sourceUrl:"https://www.gssaweb.org/superintendents/"},
  {district:"Jefferson County",fullName:"Samuel Dasher",title:"Superintendent",email:"dashers@jefferson.k12.ga.us",sourceUrl:"https://www.gssaweb.org/superintendents/"}
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
  const slots=await sql.query(`select c.id::text,a.canonical_name from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='GA' and c.scope='district' and c.verification_status='missing' and c.role_key='superintendent'`) as any[];
  let attempted=0,matched=0,filled=0;
  const touchedDistricts=new Set<string>();
  for(const contact of CONTACTS){
    if(!contact.email&&!contact.phone)continue;
    const slot=slots.find((s:any)=>key(s.canonical_name)===key(contact.district));
    if(!slot)continue;
    attempted++;touchedDistricts.add(contact.district);matched++;
    const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='candidate',evidence_note='Reachable superintendent published by GSSA or the official district directory; awaiting strict live revalidation.',updated_at=now() where id=$1 and role_key='superintendent' and verification_status='missing' returning id`,[slot.id,contact.fullName,contact.title,contact.email||null,contact.phone||null,contact.sourceUrl]) as any[];
    filled+=rows.length;
  }
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"GA",role:"superintendent",source:"GSSA + official district superintendent pages",seedRecords:CONTACTS.length,districtsNewlyAttempted:touchedDistricts.size,slotsNewlyAttempted:attempted,matched,filled,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_SUPERINTENDENT_ONLY",summary);
  return NextResponse.json(summary);
}
