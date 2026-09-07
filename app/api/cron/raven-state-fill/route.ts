import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic="force-dynamic";
export const maxDuration=300;

type Counts={total:number;verified:number;candidate:number;missing:number;rejected:number};
type RouteLoader=()=>Promise<{GET:(req:NextRequest)=>Promise<Response>|Response}>;
type StateGroup={state:string;routes:Array<{path:string;load:RouteLoader}>};

const GROUPS:StateGroup[]=[
 {state:"FL",routes:[
  {path:"/api/cron/raven-florida-authoritative",load:()=>import("../raven-florida-authoritative/route")},
  {path:"/api/cron/raven-florida-safety-authoritative",load:()=>import("../raven-florida-safety-authoritative/route")}
 ]},
 {state:"CA",routes:[{path:"/api/cron/raven-california-authoritative",load:()=>import("../raven-california-authoritative/route")}]},
 {state:"AL",routes:[{path:"/api/cron/raven-alabama-authoritative",load:()=>import("../raven-alabama-authoritative/route")}]},
 {state:"AR",routes:[{path:"/api/cron/raven-arkansas-authoritative",load:()=>import("../raven-arkansas-authoritative/route")}]},
 {state:"GA",routes:[{path:"/api/cron/raven-georgia-authoritative",load:()=>import("../raven-georgia-authoritative/route")}]},
 {state:"ID",routes:[{path:"/api/cron/raven-idaho-authoritative",load:()=>import("../raven-idaho-authoritative/route")}]},
 {state:"IL",routes:[{path:"/api/cron/raven-illinois-authoritative",load:()=>import("../raven-illinois-authoritative/route")}]},
 {state:"IN",routes:[{path:"/api/cron/raven-indiana-authoritative",load:()=>import("../raven-indiana-authoritative/route")}]},
 {state:"IA",routes:[{path:"/api/cron/raven-iowa-authoritative",load:()=>import("../raven-iowa-authoritative/route")}]},
 {state:"KY",routes:[{path:"/api/cron/raven-kentucky-authoritative",load:()=>import("../raven-kentucky-authoritative/route")}]},
 {state:"MS",routes:[{path:"/api/cron/raven-mississippi-authoritative",load:()=>import("../raven-mississippi-authoritative/route")}]},
 {state:"MT",routes:[{path:"/api/cron/raven-montana-bulk",load:()=>import("../raven-montana-bulk/route")}]},
 {state:"NE",routes:[{path:"/api/cron/raven-nebraska-authoritative",load:()=>import("../raven-nebraska-authoritative/route")}]},
 {state:"NV",routes:[{path:"/api/cron/raven-nevada-authoritative",load:()=>import("../raven-nevada-authoritative/route")}]},
 {state:"NM",routes:[{path:"/api/cron/raven-new-mexico-authoritative",load:()=>import("../raven-new-mexico-authoritative/route")}]},
 {state:"NY",routes:[{path:"/api/cron/raven-new-york-authoritative",load:()=>import("../raven-new-york-authoritative/route")}]},
 {state:"OH",routes:[{path:"/api/cron/raven-ohio-authoritative",load:()=>import("../raven-ohio-authoritative/route")}]},
 {state:"OK",routes:[{path:"/api/cron/raven-oklahoma-authoritative",load:()=>import("../raven-oklahoma-authoritative/route")}]},
 {state:"PA",routes:[{path:"/api/cron/raven-pennsylvania-authoritative",load:()=>import("../raven-pennsylvania-authoritative/route")}]},
 {state:"RI",routes:[{path:"/api/cron/raven-rhode-island-authoritative",load:()=>import("../raven-rhode-island-authoritative/route")}]},
 {state:"UT",routes:[{path:"/api/cron/raven-utah-authoritative",load:()=>import("../raven-utah-authoritative/route")}]}
];

async function counts(sql:ReturnType<typeof getSql>,state?:string):Promise<Counts>{
 const rows=await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts ${state?'where state_code=$1':''}`,state?[state]:[]) as any[];
 return rows[0] as Counts;
}

async function run(req:NextRequest,path:string,load:RouteLoader){
 const started=Date.now();
 try{
  const mod=await load();
  const res=await mod.GET(req);
  const text=await res.text();
  let body:any=null;try{body=JSON.parse(text);}catch{}
  return{path,status:res.status,ok:res.ok,body,ms:Date.now()-started};
 }catch(e){return{path,status:0,ok:false,error:e instanceof Error?e.message:String(e),ms:Date.now()-started};}
}

async function runState(req:NextRequest,sql:ReturnType<typeof getSql>,group:StateGroup){
 const before=await counts(sql,group.state);
 if(before.missing<=0)return{state:group.state,skipped:true,before,after:before,net:{verified:0,candidate:0,missing:0,rejected:0,total:0},districtsProcessed:0,runs:[]};
 const runs=await Promise.all(group.routes.map(r=>run(req,r.path,r.load)));
 const after=await counts(sql,group.state);
 const districtsProcessed=runs.reduce((n,r)=>n+Number(r.body?.districtsNewlyAttempted||r.body?.processed||r.body?.districtsProcessed||0),0);
 return{state:group.state,before,after,net:{verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected,total:after.total-before.total},districtsProcessed,runs};
}

export async function GET(req:NextRequest){
 const auth=requireInternalAuth(req);if(auth)return auth;
 const sql=getSql();
 const requested=(req.nextUrl.searchParams.get('state')||'').trim().toUpperCase();
 const globalBefore=await counts(sql);
 let selected=GROUPS;
 if(requested)selected=GROUPS.filter(g=>g.state===requested);
 else{
  const rows=await sql.query(`select state_code,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code=any($1::text[]) group by state_code having count(*) filter(where verification_status='missing')>0 order by missing desc`,[GROUPS.map(g=>g.state)]) as any[];
  const unresolved=rows.map((r:any)=>String(r.state_code));
  const ordered=unresolved.map(s=>GROUPS.find(g=>g.state===s)).filter(Boolean) as StateGroup[];
  const pageSize=4;
  const pages=Math.max(1,Math.ceil(ordered.length/pageSize));
  const page=new Date().getUTCMinutes()%pages;
  const start=page*pageSize;
  selected=ordered.slice(start,start+pageSize);
  if(selected.length<pageSize)selected=selected.concat(ordered.slice(0,pageSize-selected.length));
 }
 if(!selected.length)return NextResponse.json({ok:true,mode:'multi-state-authoritative-bulk',done:true,message:'No unresolved supported states.'});
 const states=await Promise.all(selected.map(g=>runState(req,sql,g)));
 const globalAfter=await counts(sql);
 const summary={ok:states.every((s:any)=>s.runs.every((r:any)=>r.ok)),mode:'multi-state-authoritative-bulk',statesProcessed:states.map((s:any)=>s.state),globalBefore,globalAfter,net:{verified:globalAfter.verified-globalBefore.verified,candidate:globalAfter.candidate-globalBefore.candidate,missing:globalAfter.missing-globalBefore.missing,rejected:globalAfter.rejected-globalBefore.rejected,total:globalAfter.total-globalBefore.total},states};
 console.log('RAVEN_MULTI_STATE_BULK',summary);
 return NextResponse.json(summary,{status:summary.ok?200:207});
}
