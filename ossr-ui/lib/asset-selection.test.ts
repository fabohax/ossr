import assert from 'node:assert/strict';
import { assetConfig, assetOptions, type AssetId } from './asset-selection';

assert.deepEqual(assetOptions.map(option => option.value), ['sbtc', 'usdcx']);
assert.equal(assetConfig('sbtc').label, 'sBTC');
assert.equal(assetConfig('sbtc').unitLabel, 'sats');
assert.equal(assetConfig('usdcx').label, 'USDCx');
assert.equal(assetConfig('usdcx').unitLabel, 'micro-USDCx');

const assetIds: AssetId[] = ['sbtc', 'usdcx'];
for (const assetId of assetIds) {
  assert.ok(assetConfig(assetId).label.length > 0);
  assert.ok(assetConfig(assetId).unitLabel.length > 0);
}

console.log('Asset selection config: sBTC and USDCx are exposed with the correct labels and units.');
