import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATES=['AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
type Seed={district:string;full_name:string;title:string;email:string|null;phone:string|null;source_url:string;evidence:string};

const VERIFIED_SEEDS:Record<string,Seed[]>={AZ:[
{district:'Lake Havasu Unified District (4368)',full_name:'Rebecca Stone',title:'Superintendent',email:null,phone:null,source_url:'https://www.lhusd.org/staff?page_no=4',evidence:'Current official Lake Havasu Unified School District staff directory lists Rebecca Stone as Superintendent.'},
{district:'Payson Unified District (4209)',full_name:'Linda Gibson',title:'Superintendent',email:null,phone:null,source_url:'https://pusd10.org/district-leadership/',evidence:'Current official Payson Unified School District leadership page lists Linda Gibson as Superintendent.'},
{district:'Duncan Unified District (4228)',full_name:'Eldon Merrell',title:'Superintendent',email:null,phone:'(928) 359-2472 x104',source_url:'https://aiaonline.org/schools/163',evidence:'Current Arizona Interscholastic Association member-school directory lists Eldon Merrell as Duncan Unified Superintendent.'},
{district:'Joseph City Unified District (4388)',full_name:'Bryan Fields',title:'Superintendent',email:null,phone:'(928) 288-3361',source_url:'https://aiaonline.org/schools/114',evidence:'Current Arizona Interscholastic Association member-school directory lists Bryan Fields as Joseph City Unified Superintendent.'},
{district:'Morenci Unified District (4230)',full_name:'Jennifer Morales',title:'Superintendent',email:null,phone:null,source_url:'https://www.azed.gov/sites/default/files/2025/04/6%20AR%20Report%20-%20Morenci%20UD.pdf',evidence:'Arizona Department of Education administrative review identifies Jennifer Morales as Superintendent of Morenci Unified District.'},
{district:'St Johns Unified District (4153)',full_name:'Kyle Patterson',title:'Superintendent',email:'kpatterson@staff.sjusd.net',phone:'(928) 337-2255 ext. 1105',source_url:'https://www.sjusd.net/staff',evidence:'Current official St. Johns Unified School District staff directory lists Kyle Patterson as Superintendent with direct phone and email.'},
{district:'Pima Unified District (4220)',full_name:'Stephen Estatico',title:'Superintendent',email:'sestatico@pimaschools.com',phone:'928-387-8002',source_url:'https://www.pimaschools.com/staff?page_no=2',evidence:'Current official Pima Unified School District staff directory lists Stephen Estatico as Superintendent with direct phone and email.'},
{district:'Heber-Overgaard Unified District (4392)',full_name:'Ron Tenney',title:'Superintendent',email:'ron.tenney@h-oschools.org',phone:'928-535-4622, ext. 5000',source_url:'https://www.heberovergaardschools.org/administration-staff',evidence:'Current official Heber-Overgaard Unified School District administration directory lists Ron Tenney as Superintendent with direct email and phone.'},
{district:'Nogales Unified District (4457)',full_name:'Angel Canto',title:'Superintendent',email:'acanto@nusd.k12.az.us',phone:'(520) 287-0800',source_url:'https://www.santacruzcountyaz.gov/DocumentCenter/View/22774/SCCSSO-School-Directory-FY25-26?bidId=',evidence:'Official Santa Cruz County School Superintendent FY25-26 school directory lists Angel Canto as Nogales Unified Superintendent with email and district phone.'},
{district:'Hayden-Winkelman Unified District (4212)',full_name:'Jeff Gregorich',title:'Superintendent',email:null,phone:'(520) 356-7876 x1301',source_url:'https://aiaonline.org/schools/131',evidence:'Current Arizona Interscholastic Association member-school directory lists Jeff Gregorich as Hayden-Winkelman Unified Superintendent with phone.'},
{district:'Mohave Valley Elementary District (4379)',full_name:'Cole Young',title:'Superintendent/ Title IX Coordinator',email:null,phone:'(928) 768-2507',source_url:'https://www.mvesd16.org/page/district-admin',evidence:'Current official Mohave Valley School District administration page lists Cole Young as Superintendent/Title IX Coordinator; district phone published on same page.'},
{district:'Sanders Unified District (4156)',full_name:'Kay Morris',title:'Superintendent',email:null,phone:'1(855)678-7873',source_url:'https://www.sandersusd.net/about-us/district-overview/leadership',evidence:'Current official Sanders Unified School District leadership page lists Kay Morris as Superintendent and publishes district contact number.'},
{district:'Kayenta Unified School District #27 (4396)',full_name:'Lemual Adson',title:'Superintendent of Schools',email:'Lemual.Adson@kayenta.k12.az.us',phone:null,source_url:'https://www.kayenta.k12.az.us/page/administration',evidence:'Current official Kayenta Unified School District administration page lists Lemual Adson as Superintendent of Schools with published email.'},
{district:'Pinon Unified District (4390)',full_name:'Chris Ostgaard',title:'Superintendent',email:null,phone:'(928) 725-2100',source_url:'https://aiaonline.org/schools/134',evidence:'Current Arizona Interscholastic Association member-school directory lists Chris Ostgaard as Pinon Unified Superintendent with phone.'},
{district:'Round Valley Unified District (4155)',full_name:'Slade Morgan',title:'Superintendent',email:null,phone:'(928) 333-6800',source_url:'https://aiaonline.org/schools/42',evidence:'Current Arizona Interscholastic Association member-school directory lists Slade Morgan as Round Valley Unified Superintendent with phone.'},
{district:'Red Mesa Unified District (4159)',full_name:'Dr. Risha Vanderwey',title:'Superintendent',email:null,phone:'(928) 656-4113',source_url:'https://aiaonline.org/schools/142',evidence:'Current Arizona Interscholastic Association member-school directory lists Dr. Risha Vanderwey as Red Mesa Unified Superintendent with phone.'},
{district:'San Carlos Unified District (4210)',full_name:'Shawn Pietila',title:'Superintendent',email:null,phone:'(928) 475-2315',source_url:'https://aiaonline.org/schools/104',evidence:'Current Arizona Interscholastic Association member-school directory lists Shawn Pietila as San Carlos Unified Superintendent with phone.'},
{district:'Snowflake Unified District (4391)',full_name:'Hollis Merrell',title:'Superintendent',email:null,phone:'(928) 536-4156 x7710',source_url:'https://aiaonline.org/schools/27',evidence:'Current Arizona Interscholastic Association member-school directory lists Hollis Merrell as Snowflake Unified Superintendent with phone.'},
{district:'Winslow Unified District (4387)',full_name:'Dr. Amber Martinez',title:'Superintendent',email:null,phone:'(928) 288-8101',source_url:'https://aiaonline.org/schools/77',evidence:'Current Arizona Interscholastic Association member-school directory lists Dr. Amber Martinez as Winslow Unified Superintendent with phone.'}
]};

async function count(sql:ReturnType<typeof getSql>,state:string){return(await sql.query(`select count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='verified')::int verified from raven_state_contacts where state_code=$1 and scope='district' and role_key='superintendent'`,[state])as any[])[0]}

export async function GET(req:NextRequest){
 const auth=requireInternalAuth(req);if(auth)return auth;
 const sql=getSql();
 const unresolved=await sql.query(`select state_code,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where scope='district' and role_key='superintendent' and state_code=any($1::text[]) group by state_code having count(*) filter(where verification_status='missing')>0`,[STATES])as any[];
 const by=new Map(unresolved.map(r=>[r.state_code,Number(r.missing)]));
 const state=STATES.find(s=>(by.get(s)||0)>0);
 if(!state)return NextResponse.json({ok:true,complete:true});
 const before=await count(sql,state),results:any[]=[];
 for(const s of VERIFIED_SEEDS[state]||[]){
  const rows=await sql.query(`update raven_state_contacts c set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='verified',verified_at=now(),evidence_note=$7,updated_at=now() from agencies a where c.agency_id=a.id and a.canonical_name=$1 and c.state_code=$8 and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' returning c.id::text`,[s.district,s.full_name,s.title,s.email,s.phone,s.source_url,s.evidence,state])as any[];
  if(rows.length)results.push({district:s.district,full_name:s.full_name,title:s.title,email:s.email,phone:s.phone,source_url:s.source_url});
 }
 const after=await count(sql,state);
 const summary={ok:true,mode:'48-state-superintendents-authoritative',state,verifiedAdded:results.length,before,after,results};
 console.log('RAVEN_SUPERINTENDENTS_48',summary);
 return NextResponse.json(summary);
}
