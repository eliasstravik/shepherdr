import type { CoreFiles } from './files.ts'

/** Initialize only a non-repository folder inside the owning machine's home. Keep its files uncommitted.
 *  A refusal comes back as its own words, never bun's report of an uncaught throw. */
export async function newRepository(files: CoreFiles, machine: string, bun: string, path: string) {
  const script = `const f=require('node:fs'),p=require('node:path'),o=require('node:os'),c=require('node:child_process');
try{const home=f.realpathSync(o.homedir()),target=p.resolve(process.argv.at(-1));
const inside=x=>x!==home&&x.startsWith(home+p.sep);
if(!f.existsSync(target)){let near=p.dirname(target);while(!f.existsSync(near))near=p.dirname(near);const parent=f.realpathSync(near);if(parent!==home&&!inside(parent))throw Error('Choose a folder in your home.');if(near!==p.dirname(target))throw Error('Choose an existing parent folder.');if(!f.statSync(parent).isDirectory())throw Error('Choose an existing parent folder.');f.mkdirSync(p.join(parent,p.basename(target)));}
const real=f.realpathSync(target);if(!inside(real)||!f.statSync(real).isDirectory())throw Error('Choose a folder inside your home, not home itself.');
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
const git=(args)=>c.spawnSync('git',args,{cwd:real,env,encoding:'utf8',timeout:15000,maxBuffer:1048576});
const old=git(['rev-parse','--show-toplevel']);if(old.status===0){process.stdout.write(old.stdout.trim());process.exit(0);}
for(const args of [['init','-q','--initial-branch=main'],['-c','user.useConfigOnly=false','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-q','--allow-empty','-m','First commit'],['rev-parse','--verify','HEAD']]){const r=git(args);if(r.status!==0)throw Error('Could not initialize repository: '+(r.stderr||r.error?.message||'Git failed'));}
process.stdout.write(real);}catch(e){process.stderr.write(e.message);process.exit(1)}`
  return (await files.exec(machine, [bun, '-e', script, '--', path], undefined, undefined, 50)).toString('utf8').trim()
}
