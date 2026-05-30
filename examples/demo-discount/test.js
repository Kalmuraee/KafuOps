const assert = require('assert');
const { applyDiscount } = require('./src/discount.js');

assert.strictEqual(applyDiscount(100, 20), 80, '20% off $100 should be $80');
assert.strictEqual(applyDiscount(50, 0), 50, '0% off keeps the price');

console.log('all tests passed');
