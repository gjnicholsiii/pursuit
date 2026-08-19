import { NextResponse } from "next/server";
export const dynamic="force-dynamic";
export const maxDuration=90;
const BASE="https://vendor.myfloridamarketplace.com/mfmp";
const blank={pageSize:100,type:[],status:[],agency:[],adNumber:"",agencyAdvertisementNumber:"",title:"",publishedDate:"",openDate:"",endDate:"",commodityCodes:[],intendsToParticipate:"",assignee:""};
const actionable=[
 {id:"4",value:"Invitation to Bid"},
 {id:"5",value:"Invitation to Negotiate"},
 {id:"6",value:"Request for Proposals"},
 {id:"8",value:"Request for Information"},
 {id:"9",value:"Request for Statement of Qualifications"},
];
async function post(path:string,body:unknown){const r=await fetch(BASE+path,{method:"POST",headers:{accept:"application/json,text/plain,*/*","content-type":"application/json","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"},body:JSON.stringify(body),cache:"no-store"});return {status:r.status,body:(await r.text()).slice(0,50000)}}
export async function GET(){
 const tests=[
  {name:"open_all",criteria:{...blank,status:["OPEN"]}},
  {name:"open_actionable",criteria:{...blank,status:["OPEN"],type:actionable}},
  {name:"open_actionable_deadline",criteria:{...blank,status:["OPEN"],type:actionable,endDate:"08/18/2026"}},
 ];
 const results=[];
 for(const test of tests){try{const count=await post("/pub/search/bids/count",test.criteria);const rows=await post("/pub/search/bids",{...test.criteria,page:1});results.push({name:test.name,count,rows})}catch(error){results.push({name:test.name,error:error instanceof Error?error.message:String(error)})}}
 return NextResponse.json({ok:true,results});
}
