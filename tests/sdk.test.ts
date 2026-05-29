import { describe, it, expect } from 'vitest';
import { buildErrorEvent, reportError } from '../src/sdk/node.js';

describe('Node SDK', () => {
  it('builds an uncaught_exception event from an Error', () => {
    const ev = buildErrorEvent(new TypeError('cannot read x'), { service: 'api', environment: 'staging' });
    expect(ev.type).toBe('uncaught_exception');
    expect(ev.service).toBe('api');
    expect(ev.environment).toBe('staging');
    expect(ev.message).toBe('cannot read x');
    expect(ev.stacktrace).toContain('TypeError');
    expect(ev.attributes?.exception_type).toBe('TypeError');
  });

  it('coerces non-Error values', () => {
    const ev = buildErrorEvent('boom', { service: 'api' });
    expect(ev.message).toBe('boom');
  });

  it('POSTs the event to <endpoint>/v1/events', async () => {
    let captured: { url: string; body: any } | undefined;
    const fakeFetch = (async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body) };
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;

    await reportError(new Error('boom'), { endpoint: 'http://agent:7878/', service: 'api', fetchImpl: fakeFetch });
    expect(captured!.url).toBe('http://agent:7878/v1/events');
    expect(captured!.body.message).toBe('boom');
    expect(captured!.body.service).toBe('api');
  });

  it('never throws even if the network fails', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(
      reportError(new Error('x'), { endpoint: 'http://agent', service: 'api', fetchImpl: failing }),
    ).resolves.toBeUndefined();
  });
});
