const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── PDF generation ─────────────────────────────────────────────────────────────

// Reuse one browser across requests — avoids a ~1s cold-start per PDF
let sharedBrowser = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  sharedBrowser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  sharedBrowser.on('disconnected', () => { sharedBrowser = null; });
  return sharedBrowser;
}

// ── Rate limiting ──────────────────────────────────────────────────────────────

const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW_MS;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_MAX;
}

app.post('/api/generate', async (req, res) => {
  if (isRateLimited(req.ip || req.socket.remoteAddress)) {
    return res.status(429).json({ error: 'Too many requests — try again shortly' });
  }

  let page;
  try {
    const data = req.body;

    if (!Array.isArray(data.items) || data.items.length > 100) {
      return res.status(400).json({ error: 'Too many line items (max 100)' });
    }

    const html = buildInvoiceHTML(data);

    const browser = await getBrowser();
    page = await browser.newPage();

    // 'load' is enough; our template has no external network resources
    await page.setContent(html, { waitUntil: 'load' });

    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    // page.pdf() returns Uint8Array in Puppeteer v22+ — convert to Buffer
    // so Express sends raw binary instead of serialising it as JSON
    const pdfBuffer = Buffer.from(pdfBytes);

    const safeNum = String(data.invoice?.number || 'draft')
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .replace(/\.{2,}/g, '_');
    const filename = `invoice-${safeNum}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (e) {
    console.error('PDF generation error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// ── Invoice HTML template ──────────────────────────────────────────────────────

function buildInvoiceHTML(data) {
  const { sender = {}, client = {}, items = [], invoice = {} } = data;

  const currency = invoice.currency || 'USD';
  const fmt = (n) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n || 0);

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.price) || 0), 0);
  const taxRate = parseFloat(invoice.taxRate) || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const rows = items
    .map((item) => {
      const amount = (parseFloat(item.qty) || 0) * (parseFloat(item.price) || 0);
      return `
        <tr>
          <td class="td-desc">${escHtml(item.description || '')}</td>
          <td class="td-center">${escHtml(String(item.qty || ''))}</td>
          <td class="td-right">${fmt(item.price)}</td>
          <td class="td-right td-amount">${fmt(amount)}</td>
        </tr>`;
    })
    .join('');

  const senderLines = [sender.address, sender.cityStateZip, sender.email, sender.phone]
    .filter(Boolean)
    .map(escHtml)
    .concat(sender.website ? [`<a href="${escHtml(sender.website)}" style="color:inherit">${escHtml(sender.website)}</a>`] : [])
    .join('<br>');

  const clientLines = [client.company, client.address, client.cityStateZip, client.email, client.phone]
    .filter(Boolean)
    .map(escHtml)
    .join('<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 13.5px;
    color: #1e293b;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 0;
    position: relative;
    overflow: hidden;
  }

  /* Accent bar */
  .accent {
    height: 7px;
    background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #0891b2 100%);
  }

  .body-pad { padding: 52px 56px; }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 52px;
  }

  .company-name {
    font-size: 26px;
    font-weight: 800;
    color: #4f46e5;
    letter-spacing: -0.5px;
    margin-bottom: 8px;
  }

  .company-sub {
    font-size: 11.5px;
    color: #64748b;
    line-height: 1.75;
  }

  .inv-badge {
    text-align: right;
  }

  .inv-badge .word {
    font-size: 52px;
    font-weight: 900;
    color: #e2e8f0;
    letter-spacing: -2px;
    line-height: 1;
  }

  .inv-badge .num {
    margin-top: 6px;
    font-size: 13px;
    color: #94a3b8;
  }

  .inv-badge .num span {
    color: #4f46e5;
    font-weight: 700;
  }

  /* ── Meta row ── */
  .meta {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 44px;
  }

  .label {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.8px;
    color: #94a3b8;
    margin-bottom: 10px;
  }

  .client-name {
    font-size: 17px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 5px;
  }

  .client-sub {
    font-size: 11.5px;
    color: #64748b;
    line-height: 1.75;
  }

  .dates-table td {
    padding: 4px 0;
    font-size: 12.5px;
    vertical-align: top;
  }

  .dates-table td:first-child {
    color: #94a3b8;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    padding-right: 28px;
    white-space: nowrap;
    padding-top: 5px;
  }

  .dates-table td:last-child {
    color: #1e293b;
    font-weight: 600;
    text-align: right;
  }

  /* ── Items table ── */
  .items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 28px;
  }

  .items thead tr {
    background: #4f46e5;
  }

  .items thead th {
    color: #ffffff;
    padding: 11px 14px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }

  .items thead th:first-child { text-align: left; border-radius: 8px 0 0 8px; }
  .items thead th:last-child  { border-radius: 0 8px 8px 0; }
  .items thead th:not(:first-child) { text-align: right; }

  .items tbody tr {
    border-bottom: 1px solid #f1f5f9;
  }

  .items tbody tr:last-child { border-bottom: none; }

  .items tbody tr:nth-child(even) { background: #fafbff; }

  .td-desc   { padding: 13px 14px; font-weight: 500; color: #0f172a; }
  .td-center { padding: 13px 14px; text-align: center; color: #475569; }
  .td-right  { padding: 13px 14px; text-align: right; color: #475569; }
  .td-amount { font-weight: 600; color: #1e293b !important; }

  /* ── Totals ── */
  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 44px;
  }

  .totals {
    min-width: 260px;
  }

  .totals tr td {
    padding: 5px 0;
    font-size: 13px;
  }

  .totals tr td:first-child { color: #64748b; }

  .totals tr td:last-child {
    text-align: right;
    font-weight: 600;
    color: #1e293b;
    padding-left: 48px;
  }

  .totals .tax-row td { color: #94a3b8; font-size: 12px; }

  .totals .grand-row {
    border-top: 2px solid #e2e8f0;
  }

  .totals .grand-row td {
    padding-top: 14px;
    font-size: 20px;
    font-weight: 800;
    color: #4f46e5 !important;
  }

  /* ── Notes ── */
  .notes-section {
    border-top: 1px solid #e2e8f0;
    padding-top: 24px;
  }

  .notes-text {
    font-size: 12px;
    color: #64748b;
    line-height: 1.8;
    white-space: pre-wrap;
  }

  /* ── Footer strip ── */
  .footer-strip {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #0891b2 100%);
  }
</style>
</head>
<body>
<div class="page">
  <div class="accent"></div>

  <div class="body-pad">

    <!-- Header -->
    <div class="header">
      <div>
        <div class="company-name">${escHtml(sender.name || 'Your Company')}</div>
        <div class="company-sub">${senderLines}</div>
      </div>
      <div class="inv-badge">
        <div class="word">INVOICE</div>
        <div class="num">No. <span>#${escHtml(String(invoice.number || '001'))}</span></div>
      </div>
    </div>

    <!-- Meta row -->
    <div class="meta">
      <div>
        <div class="label">Bill To</div>
        <div class="client-name">${escHtml(client.name || '')}</div>
        <div class="client-sub">${clientLines}</div>
      </div>
      <div style="text-align:right">
        <div class="label" style="text-align:right">Details</div>
        <table class="dates-table">
          <tr><td>Issue Date</td><td>${escHtml(invoice.date || '')}</td></tr>
          <tr><td>Due Date</td><td>${escHtml(invoice.dueDate || '')}</td></tr>
          ${invoice.poNumber ? `<tr><td>PO Number</td><td>${escHtml(invoice.poNumber)}</td></tr>` : ''}
        </table>
      </div>
    </div>

    <!-- Items -->
    <table class="items">
      <thead>
        <tr>
          <th style="text-align:left">Description</th>
          <th style="text-align:right">Qty</th>
          <th style="text-align:right">Unit Price</th>
          <th style="text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4" style="padding:16px;color:#94a3b8;text-align:center">No items</td></tr>'}
      </tbody>
    </table>

    <!-- Totals -->
    <div class="totals-wrap">
      <table class="totals">
        <tr><td>Subtotal</td><td>${fmt(subtotal)}</td></tr>
        ${taxRate > 0 ? `<tr class="tax-row"><td>Tax (${taxRate}%)</td><td>${fmt(taxAmount)}</td></tr>` : ''}
        <tr class="grand-row"><td>Total Due</td><td>${fmt(total)}</td></tr>
      </table>
    </div>

    <!-- Notes -->
    ${invoice.notes ? `
    <div class="notes-section">
      <div class="label" style="margin-bottom:8px">Notes &amp; Terms</div>
      <div class="notes-text">${escHtml(invoice.notes)}</div>
    </div>` : ''}

  </div>

  <div class="footer-strip"></div>
</div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Invoice Generator  →  http://localhost:${PORT}\n`);
  });
}

module.exports = { app, escHtml, buildInvoiceHTML, isRateLimited, resetRateLimit, closeBrowser };

function resetRateLimit(ip) {
  rateLimitMap.delete(ip);
}

