import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = { job_id:string; id:string; opportunity_id:string; filename:string; text_storage_key:string };
type Req = { category:string; text:string; line:number };

function compact(v:string){ return v.replace(/\s+/g," ").trim(); }
function skipRequirementMining(filename:string){
  const normalized=filename.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  return /(^| )(w 9|w9|form 1295|1295 form|certificate of interested parties)( |$)/.test(normalized);
}

function collectRequirements(lines:string[]):Req[] {
  const out:Req[]=[]; const seen=new Set<string>();
  lines.forEach((raw,i)=>{
    const line=compact(raw);
    if(line.length<25 || line.length>600) return;
    if(!/\b(shall|must|required to|are required to|is required to)\b/i.test(line)) return;
    if(/\b(if required|not required|not is required)\b/i.test(line)) return;
    if(/\b(internal revenue service|taxpayer identification|social security number|tax return)\b/i.test(line)) return;
    const key=line.toLowerCase(); if(seen.has(key)) return; seen.add(key);
    let category="submission_requirement";
    if(/bond|bonding/i.test(line)) category="bonding";
    else if(/insurance|insured/i.test(line)) category="insurance";
    else if(/certif|license|registration/i.test(line)) category="certification";
    else if(/delivery|period of performance|completion date/i.test(line)) category="performance";
    else if(/technical|specification|scope of work|statement of work/i.test(line)) category="technical";
    else if(/price|pricing|cost/i.test(line)) category="pricing";
    else if(/site visit|pre[- ]bid|preproposal|pre-proposal/i.test(line)) category="site_visit";
    out.push({category,text:line,line:i+1});
  });
  return out.slice(0,40);
}

async function finishJob(jobId:string){
  const sql=getSql();
  await sql.query(`update document_jobs set state='done',leased_until=null,lease_owner=null,updated_at=now() where id=$1::bigint`,[jobId]);
}

async function retryJob(jobId:string,error:string){
  const sql=getSql();
  await sql.query(`update document_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,run_after=now()+(interval '1 second'*least(600,power(2,attempts))),leased_until=null,lease_owner=null,last_error=$2,updated_at=now() where id=$1::bigint`,[jobId,error.slice(0,1000)]);
}

async function analyzeOne(document:Row){
  const sql=getSql();
  try{
    if(skipRequirementMining(document.filename)){
      await sql.query(`delete from requirements where document_id=$1::uuid and normalized_value->>'source'='document_text'`,[document.id]);
      await sql.query(`update opportunity_documents set extraction_status='analyzed' where id=$1::uuid`,[document.id]);
      await finishJob(document.job_id);
      return {ok:true,documentId:document.id,filename:document.filename,requirementsFound:0,skippedBoilerplate:true};
    }
    const blob=await get(document.text_storage_key,{access:"private"});
    if(!blob || blob.statusCode!==200 || !blob.stream) throw new Error("extracted_text_unavailable");
    const text=await new Response(blob.stream).text();
    const requirements=collectRequirements(text.split(/\r?\n/));

    if(requirements.length){
      await sql.query(
        `insert into requirements (opportunity_id,document_id,category,requirement_text,mandatory,evidence_locator,normalized_value,extraction_confidence)
         select $1::uuid,$2::uuid,u.category,u.requirement_text,true,
                jsonb_build_object('document_id',$2::text,'line',u.line),
                jsonb_build_object('source','document_text'),0.98
         from unnest($3::text[],$4::text[],$5::int[]) as u(category,requirement_text,line)
         where not exists (select 1 from requirements x where x.document_id=$2::uuid and x.requirement_text=u.requirement_text)`,
        [document.opportunity_id,document.id,requirements.map(r=>r.category),requirements.map(r=>r.text),requirements.map(r=>r.line)]
      );
    }

    await sql.query(`update opportunity_documents set extraction_status='analyzed' where id=$1::uuid`,[document.id]);
    await finishJob(document.job_id);
    return {ok:true,documentId:document.id,filename:document.filename,requirementsFound:requirements.length};
  }catch(error){
    const message=error instanceof Error?error.message:"evidence_analysis_failed";
    await retryJob(document.job_id,message);
    return {ok:false,documentId:document.id,reason:message};
  }
}

export async function GET(){
  const sql=getSql();
  await sql.query(`update document_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,run_after=now()+(interval '1 second'*least(600,power(2,attempts))),leased_until=null,lease_owner=null,last_error=coalesce(last_error,'lease expired'),updated_at=now() where state='leased' and leased_until<now()`);

  const owner=`vercel-analyze-${crypto.randomUUID()}`;
  const rows=await sql.query(
    `with claim as (
       select j.id from document_jobs j
       join opportunity_documents d on d.id=j.document_id
       join opportunities o on o.id=d.opportunity_id
       where j.stage='analyze' and j.state='pending' and j.run_after<=now()
         and d.extraction_status='text_extracted' and o.status='open'
         and (o.due_at is null or o.due_at>=now())
       order by j.priority,j.run_after,j.id
       limit 80 for update skip locked
     ), leased as (
       update document_jobs j set state='leased',leased_until=now()+interval '10 minutes',lease_owner=$1,attempts=attempts+1,updated_at=now()
       from claim where j.id=claim.id returning j.id as job_id,j.document_id
     )
     select leased.job_id::text,d.id,d.opportunity_id,d.filename,ef.normalized_value->>'text_storage_key' as text_storage_key
     from leased join opportunity_documents d on d.id=leased.document_id
     join extracted_facts ef on ef.document_id=d.id and ef.fact_type='document_text_extract'
     where ef.normalized_value->>'text_storage_key' is not null`,[owner]
  ) as Row[];

  if(!rows.length) return NextResponse.json({ok:true,processed:0,message:"No analysis jobs are waiting"});
  const results=[] as Array<Record<string,unknown>>;
  const concurrency=12;
  for(let i=0;i<rows.length;i+=concurrency) results.push(...await Promise.all(rows.slice(i,i+concurrency).map(analyzeOne)));
  const analyzed=results.filter(result=>result.ok).length;
  return NextResponse.json({ok:true,processed:results.length,analyzed,failed:results.length-analyzed,requirementsFound:results.reduce((sum,result)=>sum+Number(result.requirementsFound||0),0)});
}
