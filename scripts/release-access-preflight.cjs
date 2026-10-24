'use strict';
// Authenticate the existing protected release token without changing GitHub.
async function checkReleaseAccess({token,request=fetch}){
 if(!token)throw Error('Missing protected SYTER_RELEASE_TOKEN; public release would be blocked');
 async function get(path){const response=await request('https://api.github.com'+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});if(!response.ok)throw Error('Release access preflight HTTP '+response.status);return response.json();}
 const user=await get('/user'),repo=await get('/repos/mishakozlov723-wq/syter-releases');
 if(!user.login||repo.full_name!=='mishakozlov723-wq/syter-releases'||repo.permissions?.push!==true)throw Error('Existing release token lacks expected repository push access');
 return {login:user.login,repository:repo.full_name};
}
if(require.main===module)checkReleaseAccess({token:process.env.SYTER_RELEASE_TOKEN}).then(r=>console.log('PASS: existing release token authenticated for '+r.repository+'; no writes attempted (actual release-API writes remain separately gated)')).catch(e=>{console.error(e.message);process.exit(1);});
module.exports={checkReleaseAccess};
