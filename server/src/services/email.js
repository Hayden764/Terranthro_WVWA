/**
 * Email service — wraps Resend for transactional emails.
 *
 * Required env vars:
 *   RESEND_API_KEY   — API key from https://resend.com
 *   EMAIL_FROM       — Sender address (e.g. "Terranthro <portal@terranthro.com>")
 *   PORTAL_BASE_URL  — Frontend URL for magic-link redirects
 */
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM || 'Terranthro <noreply@terranthro.com>';
const PORTAL_BASE_URL = (process.env.PORTAL_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');

/**
 * Send a magic-link login email to a winery account holder.
 */
export async function sendMagicLinkEmail(toEmail, token, wineryName) {
  const link = `${PORTAL_BASE_URL}/portal/verify?token=${token}`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `Sign in to your ${wineryName} portal`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #483729;">
        <h2 style="color: #483729;">Terranthro — Winery Portal</h2>
        <p>Hi,</p>
        <p>Click below to sign in to the <strong>${escapeHtml(wineryName)}</strong> portal:</p>
        <p style="margin: 24px 0;">
          <a href="${link}"
             style="background: #6B8F3C; color: #fff; padding: 12px 28px;
                    border-radius: 6px; text-decoration: none; font-size: 16px;">
            Sign In
          </a>
        </p>
        <p style="font-size: 13px; color: #888;">
          This link expires in 15 minutes. If you didn't request this, you can safely ignore it.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Failed to send magic link email:', error);
    throw new Error('Email delivery failed');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
