function calcSubtotal(items) {
  return items.reduce((s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.price) || 0), 0);
}

function calcTax(subtotal, taxRate) {
  return subtotal * ((parseFloat(taxRate) || 0) / 100);
}

function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Pure validation — returns an error string or null.
// Mirror of app.js validate() but decoupled from the DOM.
function validateInvoice(data) {
  if (!data.sender?.name)    return 'Business name is required';
  if (!data.client?.name)    return 'Client name is required';
  if (!data.invoice?.number) return 'Invoice number is required';
  if (!data.invoice?.date)   return 'Issue date is required';
  if (!data.items?.length)   return 'Add at least one line item';
  if (data.items.some(i => !i.description)) return 'All line items need a description';
  return null;
}

module.exports = { calcSubtotal, calcTax, escAttr, validateInvoice };
