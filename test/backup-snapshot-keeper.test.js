'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('snapshot keeper shutdown is bounded when the PostgreSQL client ignores TERM',()=>{
  const helper=path.join(__dirname,'..','ops','backup','snapshot-keeper.sh');
  const program=[
    'source "$1"',
    'trap "" TERM',
    'sleep 30 &',
    'keeper=$!',
    'stop_snapshot_keeper "$keeper"',
    'if kill -0 "$keeper" 2>/dev/null; then exit 9; fi'
  ].join('\n');
  const result=spawnSync('bash',['-c',program,'backup-keeper-test',helper],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('snapshot keeper shutdown is harmless for an already exited process',()=>{
  const helper=path.join(__dirname,'..','ops','backup','snapshot-keeper.sh');
  const program=[
    'source "$1"',
    'sleep 0.05 &',
    'keeper=$!',
    'wait "$keeper"',
    'stop_snapshot_keeper "$keeper"'
  ].join('\n');
  const result=spawnSync('bash',['-c',program,'backup-keeper-test',helper],{encoding:'utf8',timeout:3000});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
