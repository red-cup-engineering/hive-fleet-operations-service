import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordTerraCoreActionReceipt,readTerraCoreActionReceipts,TERRACORE_ACTION_CATEGORY} from '../src/core/terracoreSettlement.mjs';
import {recordClaim} from '../src/core/journal.mjs';
const root=await mkdtemp(join(tmpdir(),'rowan-settlement-'));
try {
 const tx='1'.repeat(40), receipt={kind:'aagaard.terracore-one-action-receipt',account:'fixture',transactionId:tx,status:'settlement-pending',settlement:{confirmed:false,retryAllowed:false,reason:'provider disagreement'},before:{scrap:'9007199254740993.003'}};
 const event=await recordTerraCoreActionReceipt(root,receipt,'2026-10-06T00:00:00Z');
 const rows=await readTerraCoreActionReceipts(root,tx);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].receipt,receipt);assert.equal(rows[0].receipt.settlement.retryAllowed,false);
 assert.deepEqual(await readTerraCoreActionReceipts(root,'2'.repeat(40)),[]);
 recordClaim(root,TERRACORE_ACTION_CATEGORY,'2026-10-06T00:01:00Z',event,{for:false,against:true});
 await assert.rejects(()=>readTerraCoreActionReceipts(root,tx),/contrary testimony/);
 console.log('Durable pending receipt recovered with exact quantities, no retry grant, transaction isolation and contested-evidence refusal.');
} finally {await rm(root,{recursive:true,force:true});}
