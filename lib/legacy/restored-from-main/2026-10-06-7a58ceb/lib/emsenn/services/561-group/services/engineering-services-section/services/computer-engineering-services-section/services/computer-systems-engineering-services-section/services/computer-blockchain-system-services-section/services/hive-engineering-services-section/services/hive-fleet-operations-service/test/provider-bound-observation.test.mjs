import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHiveFleetObservationService} from '../src/contract-fleet-observation.mjs';
import {recordClaim,claimsOf} from '../src/core/journal.mjs';
const {ACTIVITYSTREAMS_CONTEXT}=await import('@red-cup-engineering/activitypub-services-section/activitystreams');
const root=mkdtempSync(join(tmpdir(),'rowan-hive-provider-'));
try {
 const at='2026-10-06T00:00:00.000Z';
 const bindings=['one','two'].map(name=>({actor:'urn:provider:'+name,dataDir:join(root,name),tickCategory:name+'.tick',journalPrefix:name}));
 const services=bindings.map(b=>createHiveFleetObservationService(b));
 bindings.forEach((b,i)=>recordClaim(b.dataDir,b.tickCategory,at,{ts:at,accounts:[{account:'fixture-'+i,trading:{hive:`${i+1}.000 HIVE`,hbd:'0.000 HBD'}}]}));
 const offers=await Promise.all(services.map((s,i)=>s.run({'@context':ACTIVITYSTREAMS_CONTEXT,type:'Offer',id:'urn:request:'+i,actor:'urn:customer',target:bindings[i].actor,object:{type:'ServiceSolicitation',request:{scope:'hive-wallet-fleet-custody',intendedUse:'provider isolation verification'}}},'solicit-service',at)));
 const invoke=(offer,b)=>({'@context':ACTIVITYSTREAMS_CONTEXT,type:'Accept',id:'urn:invocation:'+b.actor,actor:'urn:customer',target:b.actor,object:{type:'ServiceContract',offer,termsAcceptance:{termDigest:offer.object.termsDigest},capability:{type:'Capability',holder:b.actor,invocationTarget:b.actor,parentOffer:offer.id,allowedActions:['invoke-service','provider-local-witness-journal-evidence'],attenuation:{sourceTickDigest:offer.object.sourceTickDigest},capTP:{target:b.actor,method:'invoke-service'}}}});
 for(let i=0;i<2;i++){
  const result=await services[i].run(invoke(offers[i],bindings[i]),'invoke-service',at);
  assert.equal(result.type,'Accept');assert.equal(result.object.receipt.provider,bindings[i].actor);
  assert.equal(result.object.exchange.observation.accounts[0].account,'fixture-'+i);
  assert.equal(claimsOf(bindings[i].dataDir,bindings[i].journalPrefix+'.fleet-observation-receipt').length,1);
 }
 const rejected=await services[1].run(invoke(offers[0],bindings[1]),'invoke-service',at);assert.equal(rejected.type,'Reject');
 assert.equal(claimsOf(bindings[1].dataDir,'two.fleet-observation-receipt').length,1);
 assert.throws(()=>createHiveFleetObservationService({actor:'urn:provider:incomplete'}),/requires dataDir/);
 console.log('Two providers completed the observation contract using separate real semantic journals; cross-provider offer rejected; incomplete binding rejected.');
}finally{rmSync(root,{recursive:true,force:true});}
