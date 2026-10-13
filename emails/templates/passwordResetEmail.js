export function passwordResetEmailHtml(name, otp) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your TronMarket password</title>
</head>
<body style="margin:0;padding:0;background-color:#F6F7F4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F6F7F4;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(16,24,40,0.10);">
          <tr>
            <td style="background:#101828;padding:32px 40px 24px;text-align:center;">
              <span style="font-size:28px;font-weight:900;letter-spacing:-0.5px;">
                <span style="color:#ffffff;">TRON</span><span style="color:#34D399;">MARKET</span>
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#101828;">
                Reset your password
              </h1>
              <p style="margin:0 0 24px;font-size:15px;color:#667085;line-height:1.6;">
                Hi ${name}, we received a request to reset your TronMarket password. Enter the code below to choose a new one.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 28px;">
                    <div style="display:inline-block;background:#ECFDF5;border:2px solid #047857;border-radius:16px;padding:20px 40px;">
                      <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#047857;font-family:'Courier New',monospace;">
                        ${otp}
                      </span>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#667085;text-align:center;">
                This code expires in <strong style="color:#101828;">10 minutes</strong> and can only be used once.
              </p>
              <p style="margin:0;font-size:13px;color:#667085;text-align:center;">
                If you didn't request a password reset, you can safely ignore this email — your password will not change.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F6F7F4;padding:20px 40px;border-top:1px solid #EAECF0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#667085;">
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
