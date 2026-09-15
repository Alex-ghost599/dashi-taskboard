import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CandidateStore } from "../server/automation-candidate-store.mjs";
import { LocalScanState } from "../server/local-scan-state.mjs";
function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), "local-scan-state-"));
  const file = path.join(root, "control.sqlite");
  const stores=[];
  t.after(()=>{ for(const s of stores)s.close();rmSync(root,{recursive:true,force:true}); });
  return { file, open:()=>{const s=new LocalScanState(file);stores.push(s);return s;} };
}
const settings = { armed: true, intervalMs: 10000, judgePolicyRev: "1" };
const report = { status: "armed", candidates: [], blocked: [] };

test("scan settings persist with revision checks and pause does not enable dispatch", (t)=>{
  const {open}=setup(t);const s=open();
  assert.deepEqual(s.listProjects(), []);
  const first=s.configure("p1",0,settings,1000);
  assert.equal(first.revision,1);assert.equal(first.authorizesDispatch,false);
  assert.throws(()=>s.configure("p1",0,settings,1100), /STALE_SETTINGS/);
  s.close();const r=open();
  assert.equal(r.listProjects()[0].armed,true);
  r.configure("p1",1,{...settings,armed:false},1200);
  assert.equal(r.listProjects()[0].armed,false);
});

test("single coordinator lease fences old owners and paused or changed settings", (t)=>{
  const {open}=setup(t);const a=open(),b=open();
  a.configure("p1",0,settings,1000);
  assert.equal(a.acquire("owner-a",1000,1000),true);
  assert.equal(b.acquire("owner-b",1100,1000),false);
  assert.equal(b.acquire("owner-b",2000,1000),true);
  assert.equal(a.record("p1",1,"owner-a",2100,report),false);
  assert.equal(b.record("p1",1,"owner-b",2100,report),true);
  a.configure("p1",1,{...settings,armed:false},2200);
  assert.equal(b.record("p1",1,"owner-b",2300,report),false);
});

test("additive scan migration preserves existing judgment records", (t)=>{
  const {file,open}=setup(t);const old=new CandidateStore(file);
  const lease=old.claim({projectId:"p1",taskId:"t1",judgmentKey:"a".repeat(64),authRev:1,now:1000,leaseMs:1000,maxAttempts:2});
  old.start(lease.token,1100);old.markUnknown(lease.token,1200);old.close();
  const upgraded=open();assert.equal(upgraded.get(lease.token).state,"unknown");
  assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version,2);
  upgraded.close();const candidate=new CandidateStore(file);
  try{assert.equal(candidate.get(lease.token).state,"unknown");}finally{candidate.close();}
});

test("separate processes cannot steal a live scan lease and takeover fences the former owner", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { file, open } = setup(t);
  const state = open();
  state.configure("p1", 0, settings, 1000);
  assert.equal(state.acquire("first-owner", 1000, 1000), true);
  const source = `import {LocalScanState} from ${JSON.stringify(new URL("../server/local-scan-state.mjs", import.meta.url).href)};
    const state = new LocalScanState(process.argv[1]);
    try { console.log(JSON.stringify(state.acquire('second-owner', Number(process.argv[2]), 1000))); }
    finally { state.close(); }`;
  const acquire = (now) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, file, String(now)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(acquire(1500), false);
  assert.equal(acquire(2000), true);
  assert.equal(state.record("p1", 1, "first-owner", 2100, report), false);
  assert.equal(state.record("p1", 1, "second-owner", 2100, report), true);
});
