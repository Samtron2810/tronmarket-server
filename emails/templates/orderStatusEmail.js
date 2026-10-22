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
  metaRows = [],
  notice = "",
}) {
  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.name || "Item")}${
            item.productId
              ? `<br><span style="color:#6b7280;font-size:12px;">Product ID: ${escapeHtml(item.productId)}</span>`
              : ""
          }</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${Number(item.quantity || 0)}</td>
        </tr>`,
    )
    .join("");

  const metaHtml = metaRows.length
    ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
        ${metaRows
          .map(
            (row) => `<tr>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>${escapeHtml(row.label)}</strong></td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.value)}</td>
            </tr>`,
          )
          .join("")}
      </table>`
    : "";

  const noticeHtml = notice
    ? `<div style="background:#fef9e7;border:1px solid #f5d76e;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <p style="margin:0;font-size:14px;"><strong>Delivery instruction:</strong> ${escapeHtml(notice)}</p>
      </div>`
    : "";

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
      ${metaHtml}
      ${noticeHtml}
      <p style="font-size:16px;"><strong>${escapeHtml(totalLabel)}:</strong> ${escapeHtml(totalText)}</p>
      <p style="color:#6b7280;font-size:13px;">Thank you for using TronMarket.</p>
    </div>`;
}
