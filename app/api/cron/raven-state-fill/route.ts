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
  {path:"/api/cron/raven-florida-safety-authoritative",load:()=>import("../raven-florida-safety-authoritative/route")},
  {path:"/api/cron/raven-florida-district-authoritative",load:()=>import("../raven-florida-district-authoritative/route")}
 ]},
 {state:"AL",routes:[{path:"/api/cron/raven-alabama-authoritative",load:()=>import("../raven-alabama-authoritative/route")}]},
 {state:"AR",routes:[{path:"/api/cron/raven-arkansas-authoritative",load:()=>import("../raven-arkansas-authoritative/route")}]},
 {state:"ID",routes:[{path:"/api/cron/raven-idaho-authoritative",load:()=>import("../raven-idaho-authoritative/route")}]},
 {state:"IN",routes:[{path:"/api/cron/raven-indiana-authoritative",load:()=>import("../raven-indiana-authoritative/route")}]},
 {state:"IA",routes:[{path:"/api/cron/raven-iowa-authoritative",load:()=>import("../raven-iowa-authoritative/route")}]},
 {state:"MS",routes:[{path:"/api/cron/raven-mississippi-authoritative",load:()=>import("../raven-mississippi-authoritative/route")}]},
 {state:"MT",routes:[{path:"/api/cron/raven-montana-bulk",load:()=>import("../raven-montana-bulk/route")}]},
 {state:"NE",routes:[{path:"/api/cron/raven-nebraska-authoritative",load:()=>import("../raven-nebraska-authoritative/route")}]},
 {state:"NV",routes:[{path:"/api/cron/raven-nevada-authoritative",load:()=>import("../raven-nevada-authoritative/route")}]},
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
 const started=Date.now();try{const mod=await load();const res=await mod.GET(req);const text=await res.text();let body:any=null;try{body=JSON.parse(text);}catch{}return{path,status:res.status,ok:res.ok,body,ms:Date.now()-started};}catch(e){return{path,status:0,ok:false,error:e instanceof Error?e.message:String(e),ms:Date.now()-started};}
}

export async function GET(req:NextRequest){
 const auth=requireInternalAuth(req);if(auth)return auth;const sql=getSql();
 const requested=(req.nextUrl.searchParams.get('state')||'').trim().toUpperCase();
 const supported=GROUPS.map(g=>g.state);
 let state=requested&&supported.includes(requested)?requested:'';
 if(!state){
  const rows=await sql.query(`select state_code,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code=any($1::text[]) group by state_code order by case when state_code='FL' then 0 else 1 end,missing desc,state_code`,[supported]) as any[];
  state=String(rows.find(r=>Number(r.missing)>0)?.state_code||'');
 }
 if(!state)return NextResponse.json({ok:true,mode:'one-state-to-exhaustion',done:true,message:'No unresolved slots in supported state workers.'});
 const group=GROUPS.find(g=>g.state===state)!;
 const globalBefore=await counts(sql);const stateBefore=await counts(sql,state);
 const runs=[] as any[];
 for(const r of group.routes){runs.push(await run(req,r.path,r.load));}
 const globalAfter=await counts(sql);const stateAfter=await counts(sql,state);
 const districtsNewlyAttempted=runs.reduce((n,r)=>n+Number(r.body?.districtsNewlyAttempted||0),0);
 const failed=runs.filter(r=>!r.ok).length;
 return NextResponse.json({ok:failed===0,mode:'one-state-to-exhaustion',state,globalBefore,globalAfter,stateBefore,stateAfter,net:{verified:stateAfter.verified-stateBefore.verified,candidate:stateAfter.candidate-stateBefore.candidate,missing:stateAfter.missing-stateBefore.missing,rejected:stateAfter.rejected-stateBefore.rejected,total:stateAfter.total-stateBefore.total},districtsNewlyAttempted,runs,remainingInState:stateAfter.missing,nextStateEligible:stateAfter.missing===0}, {status:failed?207:200});
}
