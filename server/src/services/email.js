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
 * Send a password email to a winery account holder.
 * This is intended for temporary passwords or admin-issued resets.
 */
export async function sendPortalPasswordEmail(toEmail, wineryName, password, temporary = true) {
  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: temporary
      ? `Your temporary ${wineryName} portal password`
      : `Your ${wineryName} portal password has been updated`,
    html: `
      <div style="font-family: serif; max-width: 520px; margin: 0 auto; color: rgb(8, 10, 15);">
        <h2 style="color: rgb(8, 10, 15);">Terranthro — Winery Portal</h2>
        <p>Hi,</p>
        <p>Your portal password for the <strong>${escapeHtml(wineryName)}</strong> account has been ${temporary ? 'set' : 'updated'}.</p>
        <p style="margin: 20px 0; padding: 14px 16px; background: rgb(245, 241, 232); border-radius: 6px; border: 1px solid rgb(214, 205, 191);">
          <span style="display: block; font-size: 13px; color: rgb(64, 69, 88); margin-bottom: 8px;">Password</span>
          <code style="font-size: 18px; letter-spacing: 0.04em; color: rgb(8, 10, 15);">${escapeHtml(password)}</code>
        </p>
        <p>Sign in to the portal with this password, then change it in your profile if needed.</p>
        ${temporary ? '<p style="font-size: 13px; color: rgb(64, 69, 88);">This is a temporary password and should be changed after sign-in.</p>' : ''}
      </div>
    `,
  });

  if (error) {
    console.error('Failed to send portal password email:', error);
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

/**
 * Tell a client (OWB) a milestone has been delivered for review.
 *
 * @param {object} p
 * @param {string[]} p.to             client notify addresses
 * @param {string}   [p.replyTo]      the admin who marked it delivered (also cc'd)
 * @param {string}   p.clientName
 * @param {string}   p.contractTitle
 * @param {string}   p.milestoneLabel e.g. 'Milestone 2'
 * @param {string}   p.title
 * @param {string}   [p.note]         narrative of the completed work
 * @param {string}   p.deliveredOn    'YYYY-MM-DD'
 * @param {string}   p.reviewBy       'YYYY-MM-DD' — deemed accepted after this date
 * @param {string[]} p.fileTitles     documents attached in the portal
 */
export async function sendMilestoneDeliveredEmail(p) {
  const link = `${PORTAL_BASE_URL}/owb`;
  const fmt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  const noteHtml = p.note
    ? escapeHtml(p.note).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('')
    : '';
  const filesHtml = p.fileTitles?.length
    ? `<p style="margin-bottom: 4px;">Supporting documents in the portal:</p>
       <ul style="margin-top: 0;">${p.fileTitles.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : '';

  const { error } = await resend.emails.send({
    from: FROM,
    to: p.to,
    ...(p.replyTo ? { cc: [p.replyTo], replyTo: p.replyTo } : {}),
    subject: `${p.milestoneLabel} delivered for review: ${p.title}`,
    html: `
      <div style="font-family: serif; max-width: 560px; margin: 0 auto; color: rgb(8, 10, 15);">
        <h2 style="color: rgb(8, 10, 15); margin-bottom: 4px;">${escapeHtml(p.milestoneLabel)} delivered</h2>
        <p style="margin-top: 0; color: rgb(64, 69, 88);">${escapeHtml(p.contractTitle)}</p>
        <p>Hello ${escapeHtml(p.clientName)} team,</p>
        <p><strong>${escapeHtml(p.milestoneLabel)}: ${escapeHtml(p.title)}</strong> was delivered on
           ${fmt(p.deliveredOn)} and is ready for your review.</p>
        ${noteHtml}
        ${filesHtml}
        <p style="margin: 24px 0;">
          <a href="${link}"
             style="background: rgb(0, 196, 79); color: white; padding: 12px 28px;
                    border-radius: 6px; text-decoration: none; font-size: 16px;">
            Review in the OWB Portal
          </a>
        </p>
        <p style="font-size: 13px; color: rgb(64, 69, 88);">
          Under the contract, the milestone is accepted if no written notice of rejection is
          received by ${fmt(p.reviewBy)} (15 business days). Reply to this email with any questions.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Failed to send milestone delivered email:', error);
    throw new Error('Email delivery failed');
  }
}

/**
 * Tell Terranthro the client acted in its portal (accepted a milestone,
 * requested changes, approved an invoice).
 *
 * @param {object} p
 * @param {string}   p.to
 * @param {string}   p.subject
 * @param {string}   p.summary   one sentence, plain text
 * @param {string}   [p.note]    the client's own words (e.g. requested changes)
 */
export async function sendClientActionEmail(p) {
  const link = `${PORTAL_BASE_URL}/admin/contracts`;
  const noteHtml = p.note
    ? `<blockquote style="margin: 16px 0; padding: 10px 14px; border-left: 3px solid rgb(200, 125, 74); background: rgb(245, 241, 232);">
         ${escapeHtml(p.note).replace(/\n/g, '<br>')}
       </blockquote>`
    : '';

  const { error } = await resend.emails.send({
    from: FROM,
    to: p.to,
    subject: p.subject,
    html: `
      <div style="font-family: serif; max-width: 560px; margin: 0 auto; color: rgb(8, 10, 15);">
        <p>${escapeHtml(p.summary)}</p>
        ${noteHtml}
        <p style="margin: 24px 0;">
          <a href="${link}"
             style="background: rgb(0, 196, 79); color: white; padding: 12px 28px;
                    border-radius: 6px; text-decoration: none; font-size: 16px;">
            Open the contract
          </a>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('Failed to send client action email:', error);
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
