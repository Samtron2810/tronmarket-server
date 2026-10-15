const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function orderStatusEmail({
  heading,
  intro,
  orderId,
  status,
  totalText,
  totalLabel = "Total",
  items = [],
}) {
  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.name || "Item")}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${Number(item.quantity || 0)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:auto;">
      <h1 style="font-size:22px;">${escapeHtml(heading)}</h1>
      <p>${escapeHtml(intro)}</p>
      <p><strong>Order:</strong> #${escapeHtml(orderId)}</p>
      <p><strong>Status:</strong> ${escapeHtml(status)}</p>
      ${
        itemRows
          ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <thead><tr>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #111827;">Item</th>
                <th style="padding:8px;border-bottom:2px solid #111827;">Qty</th>
              </tr></thead><tbody>${itemRows}</tbody>
            </table>`
          : ""
      }
      <p style="font-size:16px;"><strong>${escapeHtml(totalLabel)}:</strong> ${escapeHtml(totalText)}</p>
      <p style="color:#6b7280;font-size:13px;">Thank you for using TronMarket.</p>
    </div>`;
}
