/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmt(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function $(id) { return document.getElementById(id); }

/* ── Toast ────────────────────────────────────────────────────────────────── */

let toastTimer = null;

function showToast(msg, type = 'success') {
  const toast = $('toast');
  const inner = $('toastInner');
  const icon  = $('toastIcon');
  const text  = $('toastMsg');

  text.textContent = msg;

  if (type === 'success') {
    inner.className = 'flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white bg-emerald-500';
    icon.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
  } else if (type === 'error') {
    inner.className = 'flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white bg-rose-500';
    icon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
  } else {
    inner.className = 'flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white bg-indigo-500';
    icon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  }

  toast.classList.remove('hide');
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.classList.remove('show', 'hide'), 250);
  }, 3200);
}

/* ── Config ───────────────────────────────────────────────────────────────── */

function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('invoiceConfig') || '{}');
    applyConfig(cfg);
    return cfg;
  } catch {
    return {};
  }
}

function applyConfig(cfg) {
  if (!cfg) return;

  setVal('senderName',        cfg.name);
  setVal('senderEmail',       cfg.email);
  setVal('senderPhone',       cfg.phone);
  setVal('senderAddress',     cfg.address);
  setVal('senderCityStateZip',cfg.cityStateZip);
  setVal('senderWebsite',     cfg.website);
  setVal('senderNotes',       cfg.notes);

  if (cfg.currency) setSelect('senderCurrency', cfg.currency);
  if (cfg.taxRate !== undefined) setVal('senderTaxRate', cfg.taxRate);

  // Mirror defaults into invoice fields
  if (cfg.currency) setSelect('invCurrency', cfg.currency);
  if (cfg.taxRate !== undefined) setVal('invTaxRate', cfg.taxRate);
  if (cfg.notes) setVal('invNotes', cfg.notes);

  // Invoice number
  const counter = (cfg.invoiceCounter || 0) + 1;
  setVal('invNumber', 'INV-' + String(counter).padStart(3, '0'));
}

async function saveConfig() {
  const btn = $('saveConfigBtn');
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Saving…`;

  try {
    const existing = JSON.parse(localStorage.getItem('invoiceConfig') || '{}');

    const payload = {
      ...existing,
      name:         getVal('senderName'),
      email:        getVal('senderEmail'),
      phone:        getVal('senderPhone'),
      address:      getVal('senderAddress'),
      cityStateZip: getVal('senderCityStateZip'),
      website:      getVal('senderWebsite'),
      currency:     getVal('senderCurrency'),
      taxRate:      parseFloat(getVal('senderTaxRate')) || 0,
      notes:        getVal('senderNotes'),
    };

    localStorage.setItem('invoiceConfig', JSON.stringify(payload));

    // Mirror to invoice fields
    setSelect('invCurrency', payload.currency);
    setVal('invTaxRate', payload.taxRate);
    if (!$('invNotes').value) setVal('invNotes', payload.notes);

    recalculate();
    showToast('Business info saved!');
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

/* ── Line items ───────────────────────────────────────────────────────────── */

let itemCount = 0;

function addItem(desc = '', qty = 1, price = '') {
  const id = ++itemCount;
  const list = $('itemsList');

  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.id = id;
  row.innerHTML = `
    <input type="text"   class="field-input item-desc"  placeholder="Description of service or product" value="${escAttr(desc)}" />
    <input type="number" class="field-input item-qty"   placeholder="1"    min="0" step="any" value="${escAttr(String(qty))}" />
    <input type="number" class="field-input item-price" placeholder="0.00" min="0" step="any" value="${escAttr(String(price))}" />
    <span class="item-amount">$0.00</span>
    <button class="item-remove-btn" title="Remove item">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
    </button>
  `;

  row.querySelector('.item-qty').addEventListener('input', recalculate);
  row.querySelector('.item-price').addEventListener('input', recalculate);
  row.querySelector('.item-remove-btn').addEventListener('click', () => {
    row.remove();
    recalculate();
  });

  list.appendChild(row);
  recalculate();
  row.querySelector('.item-desc').focus();
}

function recalculate() {
  const currency = getVal('invCurrency') || 'USD';
  const taxRate  = parseFloat(getVal('invTaxRate')) || 0;

  let subtotal = 0;

  document.querySelectorAll('.item-row').forEach((row) => {
    const qty   = parseFloat(row.querySelector('.item-qty').value)   || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const amount = qty * price;
    subtotal += amount;
    row.querySelector('.item-amount').textContent = fmt(amount, currency);
  });

  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  $('subtotalDisplay').textContent = fmt(subtotal, currency);
  $('taxDisplay').textContent      = fmt(taxAmount, currency);
  $('totalDisplay').textContent    = fmt(total, currency);
  $('taxLabel').textContent        = `Tax (${taxRate}%)`;

  const taxRow = $('taxRow');
  if (taxRate > 0) taxRow.classList.remove('hidden');
  else             taxRow.classList.add('hidden');
}

/* ── Collect form data ────────────────────────────────────────────────────── */

function collectData() {
  const items = [];
  document.querySelectorAll('.item-row').forEach((row) => {
    items.push({
      description: row.querySelector('.item-desc').value.trim(),
      qty:         parseFloat(row.querySelector('.item-qty').value)   || 0,
      price:       parseFloat(row.querySelector('.item-price').value) || 0,
    });
  });

  return {
    sender: {
      name:         getVal('senderName'),
      email:        getVal('senderEmail'),
      phone:        getVal('senderPhone'),
      address:      getVal('senderAddress'),
      cityStateZip: getVal('senderCityStateZip'),
      website:      getVal('senderWebsite'),
    },
    client: {
      name:         getVal('clientName'),
      company:      getVal('clientCompany'),
      email:        getVal('clientEmail'),
      phone:        getVal('clientPhone'),
      address:      getVal('clientAddress'),
      cityStateZip: getVal('clientCityStateZip'),
    },
    invoice: {
      number:   getVal('invNumber'),
      date:     getVal('invDate'),
      dueDate:  getVal('invDueDate'),
      currency: getVal('invCurrency'),
      taxRate:  parseFloat(getVal('invTaxRate')) || 0,
      poNumber: getVal('invPoNumber'),
      notes:    getVal('invNotes'),
    },
    items,
  };
}

function validate(data) {
  if (!data.sender.name)   { showToast('Business name is required', 'error'); return false; }
  if (!data.client.name)   { showToast('Client name is required',   'error'); return false; }
  if (!data.invoice.number){ showToast('Invoice number is required', 'error'); return false; }
  if (!data.invoice.date)  { showToast('Issue date is required',     'error'); return false; }
  if (data.items.length === 0) { showToast('Add at least one line item', 'error'); return false; }
  const hasEmpty = data.items.some(i => !i.description);
  if (hasEmpty) { showToast('All line items need a description', 'error'); return false; }
  return true;
}

/* ── New Invoice ──────────────────────────────────────────────────────────── */

function newInvoice() {
  if (!window.confirm('Start a new invoice? The current invoice will be cleared.')) return;

  // Clear client fields
  ['clientName', 'clientCompany', 'clientEmail', 'clientPhone', 'clientAddress', 'clientCityStateZip']
    .forEach(id => setVal(id, ''));

  // Clear invoice-only fields
  setVal('invPoNumber', '');

  // Reset dates
  const t = today();
  setVal('invDate',    t);
  setVal('invDueDate', addDays(t, 30));

  // Restore defaults from saved config
  const cfg = JSON.parse(localStorage.getItem('invoiceConfig') || '{}');
  if (cfg.currency) setSelect('invCurrency', cfg.currency);
  setVal('invTaxRate', cfg.taxRate !== undefined ? cfg.taxRate : '');
  setVal('invNotes',   cfg.notes   || '');

  // Next invoice number
  const counter = (cfg.invoiceCounter || 0) + 1;
  setVal('invNumber', 'INV-' + String(counter).padStart(3, '0'));

  // Reset line items to one empty row
  $('itemsList').innerHTML = '';
  itemCount = 0;
  addItem();

  recalculate();
  showToast('New invoice started');
}

/* ── Preview / Generate PDF ───────────────────────────────────────────────── */

async function previewPDF() {
  const data = collectData();
  if (!validate(data)) return;

  const btn = $('previewBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
      <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg> Loading…`;

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || res.statusText);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // keep the URL alive long enough for the tab to load, then release it
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function generatePDF() {
  const data = collectData();
  if (!validate(data)) return;

  const btn = $('generateBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
      <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg> Generating…`;

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || res.statusText);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `invoice-${data.invoice.number}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // Increment invoice counter in saved config
    await bumpInvoiceCounter();
    showToast('PDF downloaded!');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function bumpInvoiceCounter() {
  try {
    const cfg = JSON.parse(localStorage.getItem('invoiceConfig') || '{}');
    cfg.invoiceCounter = (cfg.invoiceCounter || 0) + 1;
    localStorage.setItem('invoiceConfig', JSON.stringify(cfg));
    setVal('invNumber', 'INV-' + String(cfg.invoiceCounter).padStart(3, '0'));
  } catch { /* non-critical */ }
}

/* ── Utility ──────────────────────────────────────────────────────────────── */

function getVal(id) { return ($(id)?.value || '').trim(); }
function setVal(id, v) { if ($(id) && v !== undefined && v !== null) $(id).value = v; }
function setSelect(id, v) {
  const el = $(id);
  if (!el || !v) return;
  [...el.options].forEach(o => { o.selected = o.value === String(v); });
}
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Init ─────────────────────────────────────────────────────────────────── */

async function init() {
  // Set date defaults
  const t = today();
  setVal('invDate',    t);
  setVal('invDueDate', addDays(t, 30));

  // Load saved config
  loadConfig();

  // Wire up buttons
  $('saveConfigBtn').addEventListener('click', saveConfig);
  $('newInvoiceBtn').addEventListener('click', newInvoice);
  $('addItemBtn').addEventListener('click', () => addItem());
  $('previewBtn').addEventListener('click', previewPDF);
  $('generateBtn').addEventListener('click', generatePDF);

  // Recalculate when tax rate or currency changes
  $('invTaxRate').addEventListener('input', recalculate);
  $('invCurrency').addEventListener('change', recalculate);

  // Start with one empty item row
  addItem();
}

document.addEventListener('DOMContentLoaded', init);
