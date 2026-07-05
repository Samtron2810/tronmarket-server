export function orderReceiptHtml(order, customerName) {
  const shortId = order._id ? String(order._id).slice(-8).toUpperCase() : "N/A";

  const dateFormatted = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : new Date().toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      });

  const itemRows = (order.orderItems || [])
    .map((item) => {
      const price = Number(item.price || 0);
      const qty = Number(item.quantity || 0);
      const lineTotal = (price * qty).toLocaleString("en-NG");
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;vertical-align:top;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#1A1A1A;">${item.name || "Item"}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#888888;">Qty: ${qty} × ₦${price.toLocaleString("en-NG")}</p>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;text-align:right;vertical-align:top;font-size:14px;font-weight:700;color:#1A1A1A;font-family:'Courier New',monospace;white-space:nowrap;">
          ₦${lineTotal}
        </td>
      </tr>`;
    })
    .join("");

  const { fullName, phone, address, city, state } = order.shippingAddress || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your TronMarket Order Receipt</title>
</head>
<body style="margin:0;padding:0;background-color:#FF8C00;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FF8C00;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.12);">

          <!-- Header -->
          <tr>
            <td style="background:#FF8C00;padding:32px 40px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:26px;font-weight:900;letter-spacing:-0.5px;">
                      <span style="color:#1A1A1A;">TRON</span><span style="color:#ffffff;">MARKET</span>
                    </span>
                    <p style="margin:4px 0 0;font-size:12px;color:#1A1A1A;opacity:0.7;">Official E-Receipt</p>
                  </td>
                  <td style="text-align:right;">
                    <span style="background:#16a34a;color:#ffffff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;">
                      Order Placed
                    </span>
                    <p style="margin:6px 0 0;font-size:11px;color:#1A1A1A;font-family:'Courier New',monospace;opacity:0.8;">
                      #${shortId}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:32px 40px 0;">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1A1A1A;">
                Your order is confirmed! 🎉
              </h1>
              <p style="margin:0;font-size:14px;color:#555555;line-height:1.6;">
                Hi ${customerName}, thank you for shopping with TronMarket. Here's a summary of your order.
              </p>
            </td>
          </tr>

          <!-- Order & Shipping Info -->
          <tr>
            <td style="padding:24px 40px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="vertical-align:top;padding-right:16px;">
                    <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:1px;">Order Info</p>
                    <p style="margin:0 0 4px;font-size:13px;color:#1A1A1A;"><strong>Date:</strong> ${dateFormatted}</p>
                    <p style="margin:0 0 4px;font-size:13px;color:#1A1A1A;"><strong>Payment:</strong> Paystack</p>
                    <p style="margin:0;font-size:13px;color:#1A1A1A;"><strong>Status:</strong>
                      <span style="color:#2B80FF;font-weight:700;text-transform:capitalize;">${order.status || "pending"}</span>
                    </p>
                  </td>
                  <td width="50%" style="vertical-align:top;padding-left:16px;border-left:1px solid #f0f0f0;">
                    <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:1px;">Shipping To</p>
                    <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#1A1A1A;">${fullName || customerName}</p>
                    ${address ? `<p style="margin:0 0 2px;font-size:13px;color:#555555;">${address}</p>` : ""}
                    ${city || state ? `<p style="margin:0 0 2px;font-size:13px;color:#555555;">${[city, state].filter(Boolean).join(", ")}</p>` : ""}
                    ${phone ? `<p style="margin:0;font-size:12px;color:#888888;font-family:'Courier New',monospace;">📞 ${phone}</p>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#888888;text-transform:uppercase;letter-spacing:1px;">Items Purchased</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${itemRows}
              </table>
            </td>
          </tr>

          <!-- Total -->
          <tr>
            <td style="padding:20px 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px dashed #e5e7eb;padding-top:16px;margin-top:4px;">
                <tr>
                  <td style="padding-top:16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:13px;color:#555555;padding-bottom:6px;">Subtotal</td>
                        <td style="text-align:right;font-size:13px;color:#555555;font-family:'Courier New',monospace;padding-bottom:6px;">
                          ₦${Number(order.totalPrice || 0).toLocaleString("en-NG")}
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#555555;padding-bottom:12px;">Shipping Fee</td>
                        <td style="text-align:right;padding-bottom:12px;">
                          <span style="font-size:11px;font-weight:800;color:#16a34a;background:#f0fdf4;padding:2px 8px;border-radius:20px;border:1px solid #bbf7d0;">FREE</span>
                        </td>
                      </tr>
                      <tr style="border-top:1px solid #e5e7eb;">
                        <td style="padding-top:12px;font-size:16px;font-weight:800;color:#1A1A1A;">Total Paid</td>
                        <td style="padding-top:12px;text-align:right;font-size:20px;font-weight:900;color:#1A1A1A;font-family:'Courier New',monospace;">
                          ₦${Number(order.totalPrice || 0).toLocaleString("en-NG")}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 40px 32px;text-align:center;">
              <a href="${process.env.CLIENT_URL || "http://localhost:5173"}/my-orders"
                style="display:inline-block;background:#2B80FF;color:#ffffff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;">
                View My Orders →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#aaaaaa;">
                © ${new Date().getFullYear()} TronMarket. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
