'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
function run(fn){return context.run({deadline:Date.now()+25000},fn);}
async function request(url,options={},timeout=5000){
  const remaining=(context.getStore()?.deadline||Date.now()+25000)-Date.now();
  if(remaining<=0)throw Object.assign(Error('Accounts request exceeded its 25 second budget. Retry later.'),{status:504,code:'ACCOUNTS_TIMEOUT'});
  try{return await fetch(url,{...options,signal:AbortSignal.timeout(Math.max(1,Math.min(timeout,remaining)))});}
  catch(err){if(err.name==='TimeoutError'||err.name==='AbortError')throw Object.assign(Error('Accounts upstream request timed out. Retry later.'),{status:504,code:'ACCOUNTS_TIMEOUT'});throw err;}
}
module.exports={run,request};
