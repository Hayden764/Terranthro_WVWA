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
const DEFAULT_PORTAL_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://wvwa.terranthro.com'
  : 'http://localhost:5173';
const PORTAL_BASE_URL = (process.env.PORTAL_BASE_URL || DEFAULT_PORTAL_BASE_URL).replace(/\/$/, '');

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
      <div style="font-family: serif; max-width: 520px; margin: 0 auto; color: rgb(8, 10, 15);">
        <h2 style="color: rgb(8, 10, 15);">Terranthro — Winery Portal</h2>
        <p>Hi,</p>
        <p>Click below to sign in to the <strong>${escapeHtml(wineryName)}</strong> portal:</p>
        <p style="margin: 24px 0;">
          <a href="${link}"
             style="background: rgb(0, 196, 79); color: white; padding: 12px 28px;
                    border-radius: 6px; text-decoration: none; font-size: 16px;">
            Sign In
          </a>
        </p>
        <p style="font-size: 13px; color: rgb(64, 69, 88);">
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

/**
 * Send an email change confirmation link to the new email address.
 */
export async function sendEmailChangeConfirmation(newEmail, token, wineryName) {
  const link = `${PORTAL_BASE_URL}/portal/confirm-email-change?token=${token}`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: newEmail,
    subject: `Confirm your new email for ${wineryName} portal`,
    html: `
      <div style="font-family: serif; max-width: 520px; margin: 0 auto; color: rgb(8, 10, 15);">
        <h2 style="color: rgb(8, 10, 15);">Terranthro — Email Change</h2>
        <p>Hi,</p>
        <p>You requested to change the login email for the <strong>${escapeHtml(wineryName)}</strong> portal to this address.</p>
        <p style="margin: 24px 0;">
          <a href="${link}"
             style="background: rgb(0, 196, 79); color: white; padding: 12px 28px;
                    border-radius: 6px; text-decoration: none; font-size: 16px;">
            Confirm Email Change
          </a>
        </p>
        <p style="font-size: 13px; color: rgb(64, 69, 88);">
          This link expires in 1 hour. If you didn't request this, you can safely ignore it.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Failed to send email change confirmation:', error);
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
