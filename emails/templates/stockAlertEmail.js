const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Low-stock / out-of-stock alert sent to a seller. `kind` is "low" or "out".
export function stockAlertEmail({ product, kind }) {
  const isOut = kind === "out";
  const heading = isOut ? "Product out of stock" : "Product running low on stock";
  const message = isOut
    ? `Your product ${escapeHtml(product.name)} with ID ${escapeHtml(product._id)} is now out of stock.`
    : `Your product ${escapeHtml(product.name)} with ID ${escapeHtml(product._id)} is going out of stock.`;
  const stockLine = isOut
    ? "Current stock level: 0 (out of stock)"
    : `Current stock level: ${Number(product.stock || 0)} remaining`;

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:auto;">
      <h1 style="font-size:22px;">${heading}</h1>
      <p>${message}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Product</strong></td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(product.name)}</td>
        </tr>
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Product ID</strong></td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(product._id)}</td>
        </tr>
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Stock</strong></td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(stockLine)}</td>
        </tr>
      </table>
      <p style="color:#6b7280;font-size:13px;">
        ${isOut
          ? "Restock this product from your seller dashboard to make it visible to buyers again."
          : "Consider restocking soon so this product does not sell out."}
      </p>
      <p style="color:#6b7280;font-size:13px;">Thank you for selling on TronMarket.</p>
    </div>`;
}
