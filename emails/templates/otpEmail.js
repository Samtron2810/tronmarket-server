export function otpEmailHtml(name, otp) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your TronMarket account</title>
</head>
<body style="margin:0;padding:0;background-color:#FF8C00;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FF8C00;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.12);">

          <!-- Header -->
          <tr>
            <td style="background:#FF8C00;padding:32px 40px 24px;text-align:center;">
              <span style="font-size:28px;font-weight:900;letter-spacing:-0.5px;">
                <span style="color:#1A1A1A;">TRON</span><span style="color:#ffffff;">MARKET</span>
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1A1A1A;">
                Verify your email address
              </h1>
              <p style="margin:0 0 24px;font-size:15px;color:#555555;line-height:1.6;">
                Hi ${name}, welcome to TronMarket! Enter the code below to confirm your email and activate your account.
              </p>

              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 28px;">
                    <div style="display:inline-block;background:#EBF2FF;border:2px solid #2B80FF;border-radius:16px;padding:20px 40px;">
                      <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#2B80FF;font-family:'Courier New',monospace;">
                        ${otp}
                      </span>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#888888;text-align:center;">
                This code expires in <strong style="color:#1A1A1A;">10 minutes</strong>.
              </p>
              <p style="margin:0;font-size:13px;color:#888888;text-align:center;">
                If you didn't create a TronMarket account, you can safely ignore this email.
              </p>
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
