import { retryPayment } from '../payment/retry.js';

interface Req { body: { customer: { defaultPaymentMethod?: { type: string } } } }
interface Res { json: (b: unknown) => void; status: (n: number) => Res }

export async function createCheckout(req: Req, res: Res): Promise<void> {
  const result = await retryPayment(req.body.customer);
  res.json(result);
}
