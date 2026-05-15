// Tiny no-build runner script for the wrapper-mode demo.
// Run via: kafuops run -- node examples/sample-app/app.js
async function retryPayment(customer) {
  // Intentional bug: throws TypeError when defaultPaymentMethod is undefined.
  return { ok: true, method: customer.defaultPaymentMethod.type };
}

setTimeout(async () => {
  try {
    await retryPayment({ /* no defaultPaymentMethod */ });
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
  }
  setTimeout(() => process.exit(0), 250);
}, 100);
