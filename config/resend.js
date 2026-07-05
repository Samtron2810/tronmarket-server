import { Resend } from "resend";

let resendClient = null;

export function getResend() {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not set — emails will be skipped");
      return null;
    }
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}
