const fs=require('node:fs');const Module=require('node:module');const path=require('node:path');const esbuild=require('esbuild');
const root=path.resolve(__dirname,'../../../..');
function load(relative){const filename=path.join(root,relative);const content=esbuild.buildSync({entryPoints:[filename],platform:'node',bundle:true,format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(content,filename);return loaded.exports;}
const {inferVideoName}=load('electron/main/services/quark/filename.ts');const {inferResourceInfo}=load('electron/main/services/quark/resourceInfo.ts');
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'cases.json')));const results=cases.map(c=>({id:c.id,parsed:inferVideoName(c.filename,c.parents),technical:inferResourceInfo(c.filename,c.parents)}));
fs.mkdirSync(path.join(root,'.harness'),{recursive:true});
fs.writeFileSync(path.join(root,'.harness/code-application-reproduced-windows-results.json'),JSON.stringify(results,null,2)+'\n');
