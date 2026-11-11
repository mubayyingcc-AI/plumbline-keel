'use strict';

class KeelApiError extends Error {
 constructor(message,{status=0,code='keel_api_error',details=null}={}){
  super(message);this.name='KeelApiError';this.status=status;this.code=code;this.details=details;
 }
}
class KeelAIReleaseClient {
 constructor({baseUrl,apiKey,fetchImpl=globalThis.fetch}={}){
  if(typeof baseUrl!=='string'||!baseUrl.trim())throw new Error('keel_base_url_required');
  let parsed;try{parsed=new URL(baseUrl);}catch{throw new Error('keel_base_url_invalid');}
  const local=parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1'||parsed.hostname==='::1';
  if(parsed.protocol!=='https:'&&!(local&&parsed.protocol==='http:'))throw new Error('keel_https_required');
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('keel_base_url_must_not_contain_credentials_or_query');
  if(typeof apiKey!=='string'||!/^kk_live_[A-Za-z0-9_-]{30,100}$/.test(apiKey))throw new Error('keel_api_key_invalid');
  if(typeof fetchImpl!=='function')throw new Error('fetch_implementation_required');
  this.baseUrl=parsed.toString().replace(/\/$/,'');
  this.apiKey=apiKey;
  this.fetchImpl=fetchImpl;
 }
 async request(path,{method='GET',body}={}){
  const url=this.baseUrl+path;
  const headers={Authorization:'Bearer '+this.apiKey,Accept:'application/json'};
  const options={method,headers};
  if(body!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  let response;
  try{response=await this.fetchImpl(url,options);}catch(error){throw new KeelApiError('Keel API request failed',{code:'keel_network_error',details:{cause:error?.name||'network_error'}});}
  let payload=null;try{payload=await response.json();}catch{}
  if(!response.ok)throw new KeelApiError(payload?.message||payload?.error||'Keel API request rejected',{status:response.status,code:payload?.error||'keel_http_error',details:payload});
  return payload;
 }
 createAssessment(assessment){return this.request('/api/ai/release-assessments',{method:'POST',body:assessment});}
 listAssessments({limit=25}={}){if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('keel_list_limit_must_be_1_to_100');return this.request('/api/ai/release-assessments?limit='+limit);}
 getAssessment(assessmentId){if(typeof assessmentId!=='string'||!/^[0-9a-f-]{36}$/i.test(assessmentId))throw new Error('keel_assessment_id_invalid');return this.request('/api/ai/release-assessments/'+encodeURIComponent(assessmentId));}
}
module.exports={KeelAIReleaseClient,KeelApiError};
