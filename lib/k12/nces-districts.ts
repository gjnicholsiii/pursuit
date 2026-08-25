import { load } from "cheerio";
import { parse } from "csv-parse/sync";
import { inflateRawSync } from "node:zlib";
import { getSql } from "@/lib/db";

const NCES_BASE = "https://nces.ed.gov/ccd/districtsearch/district_list.asp";
const NCES_DIRECTORY_ZIP = "https://nces.ed.gov/ccd/Data/zip/ccd_lea_029_2425_w_0a_051425.zip";

export const STATE_FIPS: Record<string, string> = {
  AL:"01", AK:"02", AZ:"04", AR:"05", CA:"06", CO:"08", CT:"09", DE:"10", FL:"12", GA:"13",
  HI:"15", ID:"16", IL:"17", IN:"18", IA:"19", KS:"20", KY:"21", LA:"22", ME:"23", MD:"24",
  MA:"25", MI:"26", MN:"27", MS:"28", MO:"29", MT:"30", NE:"31", NV:"32", NH:"33", NJ:"34",
  NM:"35", NY:"36", NC:"37", ND:"38", OH:"39", OK:"40", OR:"41", PA:"42", RI:"44", SC:"45",
  SD:"46", TN:"47", TX:"48", UT:"49", VT:"50", VA:"51", WA:"53", WV:"54", WI:"55", WY:"56",
};

type DistrictRow = { ncesId:string; name:string; city:string|null; county:string|null; enrollment:number|null; schools:number|null; sourceUrl:string };
type CsvRecord = Record<string, string | undefined>;
function text(v:unknown){return String(v??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim()}
function parseNumber(v:string){const n=Number(v.replace(/,/g,""));return Number.isFinite(n)?n:null}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms))}
function pageUrl(fips:string,page:number){const u=new URL(NCES_BASE);u.searchParams.set("Search","1");u.searchParams.set("State",fips);if(page>1)u.searchParams.set("DistrictPageNum",String(page));return u.toString()}
function pick(record:CsvRecord,...keys:string[]){for(const key of keys){const value=text(record[key] ?? record[key.toUpperCase()] ?? record[key.toLowerCase()]);if(value)return value}return""}
function extractCsvFromZip(buffer:Buffer){
  let eocd=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break}}
  if(eocd<0)throw new Error("NCES directory ZIP has no end-of-central-directory record");
  const entries=buffer.readUInt16LE(eocd+10);
  let offset=buffer.readUInt32LE(eocd+16);
  for(let i=0;i<entries;i++){
    if(buffer.readUInt32LE(offset)!==0x02014b50)throw new Error("NCES directory ZIP central directory is invalid");
    const method=buffer.readUInt16LE(offset+10);
    const compressedSize=buffer.readUInt32LE(offset+20);
    const fileNameLength=buffer.readUInt32LE(offset+28);
    const extraLength=buffer.readUInt16LE(offset+30);
    const commentLength=buffer.readUInt16LE(offset+32);
    const localOffset=buffer.readUInt32LE(offset+42);
    const fileName=buffer.subarray(offset+46,offset+46+fileNameLength).toString("utf8");
    if(/\.csv$/i.test(fileName)){
      if(buffer.readUInt32LE(localOffset)!==0x04034b50)throw new Error("NCES directory ZIP local header is invalid");
      const localNameLength=buffer.readUInt16LE(localOffset+26);
      const localExtraLength=buffer.readUInt16LE(localOffset+28);
      const start=localOffset+30+localNameLength+localExtraLength;
      const compressed=buffer.subarray(start,start+compressedSize);
      if(method===0)return compressed.toString("utf8");
      if(method===8)return inflateRawSync(compressed).toString("utf8");
      throw new Error(`NCES directory ZIP uses unsupported compression method ${method}`);
    }
    offset+=46+fileNameLength+extraLength+commentLength;
  }
  throw new Error("NCES directory ZIP contains no CSV file");
}

async function fetchDirectoryZipWithRetry(attempts=4){
  let lastError:unknown=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(NCES_DIRECTORY_ZIP,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0",accept:"application/zip,application/octet-stream,*/*"}});
      if(!response.ok)throw new Error(`NCES directory file returned ${response.status}`);
      const buffer=Buffer.from(await response.arrayBuffer());
      if(buffer.length<1024)throw new Error(`NCES directory file was unexpectedly small (${buffer.length} bytes)`);
      return buffer;
    }catch(error){
      lastError=error;
      if(attempt<attempts)await sleep(750*attempt);
    }
  }
  throw new Error(`NCES directory fetch failed after ${attempts} attempts: ${lastError instanceof Error?lastError.message:String(lastError)}`);
}

let directoryPromise:Promise<Map<string,DistrictRow[]>>|null=null;
async function fetchNationalDirectory(){
  if(directoryPromise)return directoryPromise;
  directoryPromise=(async()=>{
    const csv=extractCsvFromZip(await fetchDirectoryZipWithRetry());
    const records=parse(csv,{columns:true,skip_empty_lines:true,bom:true,relax_column_count:true,trim:true}) as CsvRecord[];
    const byState=new Map<string,DistrictRow[]>();
    for(const record of records){
      const ncesId=pick(record,"LEAID","LEA_ID","NCESID");
      const name=pick(record,"LEA_NAME","LEANM","NAME");
      const state=pick(record,"LSTATE","ST","STABR","STATE").toUpperCase();
      if(!ncesId||!name||!STATE_FIPS[state])continue;
      const row:DistrictRow={
        ncesId,
        name,
        city:pick(record,"LCITY","CITY","LOCATION_CITY")||null,
        county:pick(record,"CNTY_NAME","COUNTY_NAME","CONAME","COUNTY")||null,
        enrollment:parseNumber(pick(record,"MEMBER","ENROLLMENT")),
        schools:parseNumber(pick(record,"SCH","SCHOOLS")),
        sourceUrl:`https://nces.ed.gov/ccd/districtsearch/district_detail.asp?ID2=${encodeURIComponent(ncesId)}`,
      };
      const stateRows=byState.get(state)??[];
      stateRows.push(row);
      byState.set(state,stateRows);
    }
    if(!byState.size)throw new Error("NCES directory CSV parsed zero state rows");
    for(const [state,rows] of byState)byState.set(state,[...new Map(rows.map(row=>[row.ncesId,row])).values()]);
    return byState;
  })().catch(error=>{directoryPromise=null;throw error});
  return directoryPromise;
}

async function fetchHtmlWithRetry(url:string,attempts=2){let lastError:unknown=null;for(let attempt=1;attempt<=attempts;attempt++){try{const response=await fetch(url,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0",accept:"text/html,application/xhtml+xml"}});if(!response.ok)throw new Error(`NCES returned ${response.status}`);const html=await response.text();if(!html.includes("resultList")&&!html.includes("Search Results:"))throw new Error("NCES returned unexpected HTML");return html}catch(error){lastError=error;if(attempt<attempts)await sleep(500*attempt)}}throw new Error(`NCES fetch failed after ${attempts} attempts for ${url}: ${lastError instanceof Error?lastError.message:String(lastError)}`)}
async function fetchPage(fips:string,page:number){const url=pageUrl(fips,page);const html=await fetchHtmlWithRetry(url);const $=load(html);const bodyText=text($("body").text());const total=Number(bodyText.match(/Search Results:\s*([\d,]+)/i)?.[1]?.replace(/,/g,"")||0);const maxPages=Math.max(1,Math.ceil(total/15));const rows:DistrictRow[]=[];$("div.resultRow").each((_,node)=>{const cells=$(node).children("div");if(cells.length<6)return;const anchor=$(cells[1]).find("a[href*='district_detail.asp']").first();const name=text(anchor.text());const href=anchor.attr("href")||"";const id=href.match(/[?&](?:ID2|DistrictID)=(\d+)/i)?.[1];if(!id||!name)return;const address=text($(cells[1]).find("span").first().text());const city=address.match(/,\s*([^,]+),\s*[A-Z]{2}\s+\d{5}/)?.[1]?.trim()||null;const countyText=text($(cells[3]).text());const county=/county$/i.test(countyText)?countyText:null;rows.push({ncesId:id,name,city,county,enrollment:parseNumber(text($(cells[4]).text())),schools:parseNumber(text($(cells[5]).text())),sourceUrl:new URL(href,url).toString()})});return{total,maxPages,rows:[...new Map(rows.map(r=>[r.ncesId,r])).values()]}}
async function fetchStatePages(fips:string){const first=await fetchPage(fips,1);if(first.maxPages===1)return[first];const pages=[first];const remaining=Array.from({length:first.maxPages-1},(_,i)=>i+2);for(let i=0;i<remaining.length;i+=4)pages.push(...await Promise.all(remaining.slice(i,i+4).map(page=>fetchPage(fips,page))));return pages}
async function getStateRows(code:string,fips:string){
  try{
    const directory=await fetchNationalDirectory();
    const rows=directory.get(code)??[];
    if(rows.length)return{total:rows.length,maxPages:1,rows};
  }catch(error){
    console.warn("NCES national directory fallback",{stateCode:code,error:error instanceof Error?error.message:String(error)});
  }
  const pages=await fetchStatePages(fips);
  const first=pages[0];
  const rows=[...new Map(pages.flatMap(page=>page.rows).map(row=>[row.ncesId,row])).values()];
  if(first.total&&rows.length!==first.total)throw new Error(`NCES ${code} reconciliation failed: expected ${first.total}, parsed ${rows.length}`);
  return{total:first.total||rows.length,maxPages:first.maxPages,rows};
}

export async function syncNcesDistrictState(stateCode:string){const code=stateCode.toUpperCase();const fips=STATE_FIPS[code];if(!fips)throw new Error(`Unsupported state ${stateCode}`);const stateData=await getStateRows(code,fips);const rows=stateData.rows;const sql=getSql();const payload=JSON.stringify(rows.map(row=>({nces_id:row.ncesId,name:row.name,city:row.city,county:row.county,source_url:row.sourceUrl})));
const updated=await sql.query(`with input as (select * from jsonb_to_recordset($1::jsonb) as x(nces_id text,name text,city text,county text,source_url text)), matched as (select i.*,a.id,a.website from input i join agencies a on a.state_code=$2 and a.agency_type='k12' and (a.nces_id=i.nces_id or (a.nces_id is null and lower(a.canonical_name)=lower(i.name))) where a.nces_id=i.nces_id or (select count(*) from agencies a2 where a2.state_code=$2 and a2.agency_type='k12' and lower(a2.canonical_name)=lower(i.name))=1) update agencies a set nces_id=m.nces_id, website=case when a.website is null or a.website='' then m.source_url when a.website ~* '(ionwave|opengov|oregonbuys|bidnet|publicpurchase|bonfirehub|jaggaer|procurement|bidsync|periscope|scbo\\.sc\\.gov|app\\.az\\.gov|eva\\.virginia\\.gov|vendorregistry|planetbids)' then m.source_url else a.website end, city=coalesce(a.city,m.city),county=coalesce(a.county,m.county) from matched m where a.id=m.id returning a.id`,[payload,code]);
const inserted=await sql.query(`with input as (select * from jsonb_to_recordset($1::jsonb) as x(nces_id text,name text,city text,county text,source_url text)) insert into agencies(canonical_name,agency_type,jurisdiction_level,state_code,city,county,website,nces_id) select i.name,'k12','local',$2,i.city,i.county,i.source_url,i.nces_id from input i where not exists(select 1 from agencies a where a.agency_type='k12' and (a.nces_id=i.nces_id or (a.state_code=$2 and lower(a.canonical_name)=lower(i.name)))) returning id`,[payload,code]);
return{stateCode:code,ncesTotal:stateData.total,rowsParsed:rows.length,pages:stateData.maxPages,inserted:inserted.length,updated:updated.length,existing:rows.length-inserted.length-updated.length}}
export type NcesDistrictSyncResult=Awaited<ReturnType<typeof syncNcesDistrictState>>&{error?:string};
export async function syncNcesDistrictBatch(states:string[]):Promise<NcesDistrictSyncResult[]>{const results:NcesDistrictSyncResult[]=[];for(let i=0;i<states.length;i+=2){const settled=await Promise.all(states.slice(i,i+2).map(async stateCode=>{try{return await syncNcesDistrictState(stateCode)}catch(error){return{stateCode:stateCode.toUpperCase(),ncesTotal:0,rowsParsed:0,pages:0,inserted:0,updated:0,existing:0,error:error instanceof Error?error.message:String(error)}}}));results.push(...settled)}return results}
