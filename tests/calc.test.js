const { calcSubtotal, calcTax, escAttr, validateInvoice } = require('../lib/calc');

// ── calcSubtotal ──────────────────────────────────────────────────────────────

describe('calcSubtotal', () => {
  test('returns 0 for empty items', () => {
    expect(calcSubtotal([])).toBe(0);
  });

  test('calculates a single item', () => {
    expect(calcSubtotal([{ qty: 2, price: 50 }])).toBe(100);
  });

  test('sums multiple items', () => {
    expect(calcSubtotal([{ qty: 2, price: 50 }, { qty: 1, price: 25 }])).toBe(125);
  });

  test('handles string numbers', () => {
    expect(calcSubtotal([{ qty: '3', price: '10.50' }])).toBeCloseTo(31.5);
  });

  test('treats invalid qty as 0', () => {
    expect(calcSubtotal([{ qty: 'abc', price: 100 }])).toBe(0);
  });

  test('treats invalid price as 0', () => {
    expect(calcSubtotal([{ qty: 5, price: null }])).toBe(0);
  });

  test('handles fractional quantities', () => {
    expect(calcSubtotal([{ qty: 1.5, price: 200 }])).toBe(300);
  });
});

// ── calcTax ───────────────────────────────────────────────────────────────────

describe('calcTax', () => {
  test('returns 0 for 0% tax rate', () => {
    expect(calcTax(100, 0)).toBe(0);
  });

  test('calculates 10% tax correctly', () => {
    expect(calcTax(100, 10)).toBe(10);
  });

  test('calculates 20% tax correctly', () => {
    expect(calcTax(500, 20)).toBe(100);
  });

  test('handles fractional tax rates', () => {
    expect(calcTax(200, 8.5)).toBeCloseTo(17);
  });

  test('handles string tax rate', () => {
    expect(calcTax(100, '15')).toBe(15);
  });

  test('treats invalid tax rate as 0', () => {
    expect(calcTax(100, 'abc')).toBe(0);
  });
});

// ── escAttr ───────────────────────────────────────────────────────────────────

describe('escAttr', () => {
  test('escapes double quotes', () => {
    expect(escAttr('"hello"')).toBe('&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(escAttr("it's")).toBe('it&#39;s');
  });

  test('escapes < and >', () => {
    expect(escAttr('<script>')).toBe('&lt;script&gt;');
  });

  test('escapes ampersands first to avoid double-escaping', () => {
    expect(escAttr('a&b')).toBe('a&amp;b');
  });

  test('escapes a full XSS payload', () => {
    const result = escAttr('" onerror="alert(1)');
    expect(result).not.toContain('"');
    expect(result).toContain('&quot;');
  });

  test('coerces non-string input', () => {
    expect(escAttr(42)).toBe('42');
    expect(escAttr(null)).toBe('null');
  });
});

// ── validateInvoice ───────────────────────────────────────────────────────────

describe('validateInvoice', () => {
  const valid = {
    sender:  { name: 'Acme Inc.' },
    client:  { name: 'Jane Smith' },
    invoice: { number: 'INV-001', date: '2026-05-17' },
    items:   [{ description: 'Web design', qty: 1, price: 500 }],
  };

  test('returns null for fully valid data', () => {
    expect(validateInvoice(valid)).toBeNull();
  });

  test('requires sender name', () => {
    expect(validateInvoice({ ...valid, sender: {} })).toMatch(/business name/i);
  });

  test('requires client name', () => {
    expect(validateInvoice({ ...valid, client: {} })).toMatch(/client name/i);
  });

  test('requires invoice number', () => {
    expect(validateInvoice({ ...valid, invoice: { date: '2026-05-17' } })).toMatch(/invoice number/i);
  });

  test('requires issue date', () => {
    expect(validateInvoice({ ...valid, invoice: { number: 'INV-001' } })).toMatch(/issue date/i);
  });

  test('requires at least one item', () => {
    expect(validateInvoice({ ...valid, items: [] })).toMatch(/line item/i);
  });

  test('requires item descriptions', () => {
    const noDesc = { ...valid, items: [{ description: '', qty: 1, price: 100 }] };
    expect(validateInvoice(noDesc)).toMatch(/description/i);
  });

  test('validates all required fields before item check', () => {
    // sender name missing → should fail on sender, not on items
    const result = validateInvoice({ sender: {}, client: {}, invoice: {}, items: [] });
    expect(result).toMatch(/business name/i);
  });
});
