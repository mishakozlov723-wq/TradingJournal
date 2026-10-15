const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),legacy=fs.readFileSync(path.join(__dirname,'trading-models.test.cjs'),'utf8');
const stub=legacy.slice(legacy.indexOf('function installFirestoreDouble()'),legacy.indexOf("test('all application"));
function extendDouble(){
 window.testTitleReads=[];window.testPartialTitle=false;
const db=firebase.firestore(),collection=db.collection.bind(db);db.collection=name=>{const c=collection(name),doc=c.doc;c.doc=id=>{const r=doc(id),get=r.get;r.get=function(options){if(name==='titles'){testTitleReads.push(options||{});if(window.testPartialTitle&&options?.source!=='server')return Promise.resolve({exists:true,data:()=>({uid:firebase.auth().currentUser?.uid}),metadata:{fromCache:true,hasPendingWrites:true}});}return get.call(r);};r.update=async values=>{const snap=await r.get();if(!snap.exists)throw Object.assign(Error('not found'),{code:'not-found'});const v=snap.data()||{};for(const [key,n]of Object.entries(values)){const parts=key.split('.');let o=v;for(const part of parts.slice(0,-1))o=o[part]??={};const k=parts.at(-1);o[k]=typeof n==='number'?(Number(o[k])||0)+n:n;}return r.set(v);};return r;};return c;};}

let html=require('./assembled-html.cjs')().replace(/<script\b[^>]*src="https:[^"]+"[^>]*><\/script>/g,'').replace('<script>','<script>'+stub+'installFirestoreDouble();('+extendDouble.toString()+')();</script><script>');

html=html.replace(/<script id="notes-workspace-script">([\s\S]*?)<\/script>/,function(all,body){return '<script id="notes-workspace-script">'+body.replace(/\}\)\(\);\s*$/,`window.NTM={async start(){notesWorkspaceMode=true;document.body.classList.add('notes-workspace-mode');document.getElementById('notesWorkspace').setAttribute('aria-hidden','false');await notesLoad(true);if(!notesPages.length)notesAddPage(null);},page:notesCurrentPage,share:notesOpenSharePanel,save:notesSave,exit:exitNotesWorkspace,write:notesWriteShare,disable:notesDisableShare,generate:notesGenerateShare,close:notesCloseMenus,deletePage:notesDeletePageNow};})();`)+'</script>';});

const server=http.createServer((req,res)=>{if(req.url.split('?')[0]==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}else{const f=path.join(root,req.url.split('?')[0]);if(f.startsWith(root)&&fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'image/png');res.end(fs.readFileSync(f));}else{res.statusCode=404;res.end();}}});

module.exports={server,chromium};




