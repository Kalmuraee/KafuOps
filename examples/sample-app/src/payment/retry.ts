export async function retryPayment(customer: { defaultPaymentMethod?: { type: string } }) {
  // BUG: does not handle the case where defaultPaymentMethod is undefined.
  const method = customer.defaultPaymentMethod!.type;
  return { ok: true, method };
}
