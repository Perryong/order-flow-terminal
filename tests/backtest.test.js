const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

test('backtest preserves unclassified trades and applies a dated gold contract multiplier', () => {
  const dir = mkdtempSync(join(tmpdir(),'orderflow-'));
  try {
    const input = join(dir,'GCZ6-ticks.csv');
    for (const [side, expected] of [['unknown',0], ['0',1]]) {
      const rows = Array.from({length:4}, (_,i) => [i + 1,4000 + i/10,1,side].join(','));
      writeFileSync(input,['time_ms,price,qty,sell',...rows].join('\n'));
      const result = spawnSync(process.execPath,[join(__dirname,'../scripts/backtest.js'),input],{encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      const sweep = result.stdout.split('\n').find(line=>line.includes("'sweep'"));
      assert.match(sweep, new RegExp("'sweep'\\s*│\\s*"+expected+'\\s*│'));
    }
  } finally { rmSync(dir,{recursive:true, force:true}); }
});
