const request = require('supertest');
const { app, escHtml, buildInvoiceHTML, isRateLimited, resetRateLimit, closeBrowser } = require('../server');

// Puppeteer startup adds latency — give integration tests room to breathe
jest.setTimeout(30000);

afterAll(async () => {
  await closeBrowser();
});

const VALID_PAYLOAD = {
  sender:  { name: 'Acme Inc.', email: 'hi@acme.com', address: '123 Main St' },
  client:  { name: 'Jane Smith', company: 'Client Corp' },
  invoice: { number: 'INV-001', date: '2026-05-17', dueDate: '2026-06-16', currency: 'USD', taxRate: 10 },
  items:   [{ description: 'Web design', qty: 2, price: 500 }],
};

// ── escHtml ───────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  test('escapes &', () => expect(escHtml('a&b')).toBe('a&amp;b'));
  test('escapes <', () => expect(escHtml('<tag>')).toBe('&lt;tag&gt;'));
  test('escapes >', () => expect(escHtml('a>b')).toBe('a&gt;b'));
  test('escapes "', () => expect(escHtml('"quoted"')).toBe('&quot;quoted&quot;'));
  test('coerces numbers', () => expect(escHtml(42)).toBe('42'));
  test('handles empty string', () => expect(escHtml('')).toBe(''));
});

// ── buildInvoiceHTML ──────────────────────────────────────────────────────────

describe('buildInvoiceHTML', () => {
  test('includes company name in output', () => {
    expect(buildInvoiceHTML(VALID_PAYLOAD)).toContain('Acme Inc.');
  });

  test('includes client name in output', () => {
    expect(buildInvoiceHTML(VALID_PAYLOAD)).toContain('Jane Smith');
  });

  test('includes invoice number', () => {
    expect(buildInvoiceHTML(VALID_PAYLOAD)).toContain('INV-001');
  });

  test('calculates and renders correct total (2×500 + 10% tax = 1100)', () => {
    // Intl.NumberFormat renders $1,100.00
    expect(buildInvoiceHTML(VALID_PAYLOAD)).toContain('1,100');
  });

  test('omits tax row when taxRate is 0', () => {
    const html = buildInvoiceHTML({ ...VALID_PAYLOAD, invoice: { ...VALID_PAYLOAD.invoice, taxRate: 0 } });
    expect(html).not.toContain('<tr class="tax-row"');
  });

  test('shows tax row when taxRate > 0', () => {
    expect(buildInvoiceHTML(VALID_PAYLOAD)).toContain('<tr class="tax-row"');
  });

  test('renders "No items" row when items array is empty', () => {
    expect(buildInvoiceHTML({ ...VALID_PAYLOAD, items: [] })).toContain('No items');
  });

  test('omits PO Number row when not provided', () => {
    expect(buildInvoiceHTML(VALID_PAYLOAD)).not.toContain('PO Number');
  });

  test('shows PO Number when provided', () => {
    const payload = { ...VALID_PAYLOAD, invoice: { ...VALID_PAYLOAD.invoice, poNumber: 'PO-999' } };
    expect(buildInvoiceHTML(payload)).toContain('PO-999');
  });

  test('escapes XSS in sender name', () => {
    const html = buildInvoiceHTML({ ...VALID_PAYLOAD, sender: { name: '<script>alert(1)</script>' } });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  test('escapes XSS in client name', () => {
    const html = buildInvoiceHTML({ ...VALID_PAYLOAD, client: { name: '"><img onerror=alert(1)>' } });
    expect(html).not.toContain('<img onerror');
  });

  test('escapes XSS in item description', () => {
    const payload = { ...VALID_PAYLOAD, items: [{ description: '<b onclick=alert(1)>click</b>', qty: 1, price: 0 }] };
    expect(buildInvoiceHTML(payload)).not.toContain('<b onclick');
    expect(buildInvoiceHTML(payload)).toContain('&lt;b');
  });

  test('escapes XSS in sender address fields', () => {
    const html = buildInvoiceHTML({
      ...VALID_PAYLOAD,
      sender: { name: 'Acme', address: '<script>evil()</script>' },
    });
    expect(html).not.toContain('<script>evil');
  });

  test('renders website as a link', () => {
    const html = buildInvoiceHTML({
      ...VALID_PAYLOAD,
      sender: { ...VALID_PAYLOAD.sender, website: 'https://acme.com' },
    });
    expect(html).toContain('<a href="https://acme.com"');
  });

  test('uses fallback company name when sender.name is empty', () => {
    const html = buildInvoiceHTML({ ...VALID_PAYLOAD, sender: {} });
    expect(html).toContain('Your Company');
  });
});

// ── POST /api/generate ────────────────────────────────────────────────────────

describe('POST /api/generate', () => {
  // Reset rate limit for localhost before each test
  beforeEach(() => {
    ['::ffff:127.0.0.1', '127.0.0.1', '::1'].forEach(resetRateLimit);
  });

  test('returns 200 with PDF content-type', async () => {
    const res = await request(app).post('/api/generate').send(VALID_PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('sets attachment content-disposition with invoice number', async () => {
    const res = await request(app).post('/api/generate').send(VALID_PAYLOAD);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('INV-001');
  });

  test('response body is a non-empty buffer', async () => {
    const res = await request(app).post('/api/generate').send(VALID_PAYLOAD);
    expect(res.body).toBeTruthy();
    expect(parseInt(res.headers['content-length'])).toBeGreaterThan(0);
  });

  test('sanitizes dangerous characters in filename', async () => {
    const payload = { ...VALID_PAYLOAD, invoice: { ...VALID_PAYLOAD.invoice, number: '../evil"; rm -rf /' } };
    const res = await request(app).post('/api/generate').send(payload);
    expect(res.status).toBe(200);
    const disposition = res.headers['content-disposition'];
    const filename = disposition.match(/filename="([^"]+)"/)[1];
    expect(filename).not.toContain('..');
    expect(filename).not.toContain(';');
    expect(filename).not.toContain('/');
  });

  test('returns 400 for more than 100 items', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      items: Array.from({ length: 101 }, (_, i) => ({ description: `Item ${i}`, qty: 1, price: 10 })),
    };
    const res = await request(app).post('/api/generate').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too many/i);
  });

  test('returns 400 when items is not an array', async () => {
    const res = await request(app).post('/api/generate').send({ ...VALID_PAYLOAD, items: 'bad' });
    expect(res.status).toBe(400);
  });

  test('exactly 100 items is accepted', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      items: Array.from({ length: 100 }, (_, i) => ({ description: `Item ${i}`, qty: 1, price: 1 })),
    };
    const res = await request(app).post('/api/generate').send(payload);
    expect(res.status).toBe(200);
  });
});

// ── Rate limiting (unit-tested directly to avoid 10× Puppeteer launches) ─────

describe('isRateLimited', () => {
  test('allows first 10 requests from the same IP', () => {
    const ip = `test-allow-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(isRateLimited(ip)).toBe(false);
    }
  });

  test('blocks the 11th request from the same IP', () => {
    const ip = `test-block-${Date.now()}`;
    for (let i = 0; i < 10; i++) isRateLimited(ip);
    expect(isRateLimited(ip)).toBe(true);
  });

  test('different IPs have independent counters', () => {
    const ip1 = `test-ip1-${Date.now()}`;
    const ip2 = `test-ip2-${Date.now()}`;
    for (let i = 0; i < 10; i++) isRateLimited(ip1);
    // ip1 is now blocked but ip2 should be clear
    expect(isRateLimited(ip2)).toBe(false);
  });

  test('resetRateLimit clears the counter for an IP', () => {
    const ip = `test-reset-${Date.now()}`;
    for (let i = 0; i < 10; i++) isRateLimited(ip);
    expect(isRateLimited(ip)).toBe(true);
    resetRateLimit(ip);
    expect(isRateLimited(ip)).toBe(false);
  });
});
