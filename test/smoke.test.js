const assert = require('assert');
const { run } = require('../skills/title-gen/src/index');

async function smokeTest() {
  console.log('Running smoke test...');
  
  try {
    const result = await run('纯银项链女高级感', { silent: true });
    
    assert(result, 'Result should not be null/undefined');
    assert(Array.isArray(result.products), 'result.products should be an array');
    assert(result.stats, 'result.stats should exist');
    assert(typeof result.stats.coreWord === 'string' && result.stats.coreWord.length > 0, 'result.stats.coreWord should be a non-empty string');
    
    if (result.products.length > 0) {
      result.products.forEach(product => {
        assert(product['商品标题'] !== undefined || product['铺货标题'] !== undefined, 'Product should have title');
        assert(product['商品原价'] !== undefined, 'Product should have price');
        assert(product['30天销量'] !== undefined, 'Product should have sales');
      });
    }
    
    console.log('✅ Smoke test passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Smoke test failed:', error);
    process.exit(1);
  }
}

smokeTest();
