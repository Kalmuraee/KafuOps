// Apply a percentage discount. `percent` is a whole number, e.g. 20 means 20% off.
//
// PLANTED BUG: this treats `percent` as a fraction, so applyDiscount(100, 20)
// returns -1900 instead of 80. The test below fails until it's fixed.
function applyDiscount(price, percent) {
  return price - price * percent;
}

module.exports = { applyDiscount };
