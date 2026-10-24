'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),acorn=require('acorn'),assert=require('node:assert/strict');
const root=path.resolve(process.env.TJ_TEST_SOURCE||path.join(__dirname,'..'));
function source(file){return fs.readFileSync(path.join(root,file),'utf8');}
function fn(file,name){const text=source(file),tree=acorn.parse(text,{ecmaVersion:'latest',sourceType:'module'});let result;function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id.name===name)result=text.slice(n.start,n.end);for(const value of Object.values(n)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}walk(tree);assert.ok(result,name);return result;}
function load(file,names,context={}){vm.createContext(context);vm.runInContext(names.map(name=>fn(file,name)).join('\n'),context);return context;}
module.exports={root,source,fn,load};
