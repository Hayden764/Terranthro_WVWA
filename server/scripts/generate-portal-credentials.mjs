/**
 * generate-portal-credentials.mjs
 * ================================
 * Pre-issues portal login credentials (username + temporary password) for
 * organizations so they can be shipped out without depending on the org
 * completing self-signup or having a correct email on file.
 *
 * For every organization (row in `wineries`) it upserts a `winery_accounts`
 * row and:
 *   • assigns a unique username (slug of the org title) if it has none;
 *   • sets a fresh random temp password (bcrypt, cost 12) with
 *     password_must_change = TRUE — but only if the account has no password yet
 *     (or --reset is passed).
 *
 * It writes a CSV of the issued credentials (org, username, temp password,
 * email) so you can distribute them. The CSV lands under data-pipeline/data/
 * (gitignored) by default — it contains plaintext temp passwords, so never
 * commit it.
 *
 * Requires DATABASE_URL (loaded from server/.env via db/pool.js).
 *
 * Usage:
 *   node scripts/generate-portal-credentials.mjs [options]
 *
 * Options:
 *   --reset            Re-issue a temp password even for accounts that already
 *                      have one (forces password_must_change = TRUE).
 *   --members-only     Only orgs with is_wvwa_member = true.
 *   --out <path>       CSV output path.
 *   --length <n>       Temp password length (default 12).
 *   --dry-run          Print what would change; write nothing to the DB or CSV.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const RESET       = has('--reset');
const MEMBERS_ONLY = has('--members-only');
const DRY_RUN     = has('--dry-run');
const PW_LENGTH   = Math.max(8, parseInt(opt('--length', '12'), 10) || 12);
const stamp       = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT_PATH    = opt('--out', path.join(REPO_ROOT, 'data-pipeline', 'data', `portal-credentials-${stamp}.csv`));

// ── Helpers ──────────────────────────────────────────────────────────────────

// Unambiguous alphabet (no 0/O/1/l/I) for human-typable temp passwords.
const PW_ALPHABET = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword(len = PW_LENGTH) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)];
  }
  return out;
}

// Slug that satisfies the username rule /^[a-z0-9._-]{3,64}$/.
function slugify(title, wineryId) {
  let s = String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s._-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);
  if (s.length < 3) s = `org-${wineryId}`;
  return s;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    // Preload taken usernames (case-insensitive) so we can de-duplicate.
    const { rows: takenRows } = await client.query(
      `SELECT LOWER(username) AS u FROM winery_accounts WHERE username IS NOT NULL`
    );
    const taken = new Set(takenRows.map((r) => r.u));

    const uniqueUsername = (base) => {
      let candidate = base;
      let n = 2;
      while (taken.has(candidate)) candidate = `${base}-${n++}`;
      taken.add(candidate);
      return candidate;
    };

    // Organizations to provision.
    const { rows: orgs } = await client.query(
      `SELECT id, title FROM wineries
       ${MEMBERS_ONLY ? 'WHERE is_wvwa_member = true' : ''}
       ORDER BY title`
    );

    const issued = [];
    let created = 0, usernamed = 0, passworded = 0, skipped = 0;

    for (const org of orgs) {
      const { rows: existingRows } = await client.query(
        `SELECT id, username, contact_email, password_hash
         FROM winery_accounts WHERE winery_id = $1`,
        [org.id]
      );
      const existing = existingRows[0] || null;

      const username = existing?.username || uniqueUsername(slugify(org.title, org.id));
      const needsUsername = !existing?.username;
      const setPassword = RESET || !existing || !existing.password_hash;
      const temp = setPassword ? tempPassword() : null;
      const hash = temp ? await bcrypt.hash(temp, 12) : null;

      if (!needsUsername && !setPassword) { skipped++; continue; }

      if (!DRY_RUN) {
        if (existing) {
          const sets = ['username = $2'];
          const vals = [org.id, username];
          if (setPassword) {
            vals.push(hash);
            sets.push(`password_hash = $${vals.length}`, 'password_must_change = TRUE');
          }
          await client.query(
            `UPDATE winery_accounts SET ${sets.join(', ')} WHERE winery_id = $1`,
            vals
          );
        } else {
          await client.query(
            `INSERT INTO winery_accounts
               (winery_id, username, password_hash, password_must_change)
             VALUES ($1, $2, $3, TRUE)`,
            [org.id, username, hash]
          );
          created++;
        }
      }

      if (needsUsername) usernamed++;
      if (setPassword) passworded++;

      issued.push({
        org: org.title,
        winery_id: org.id,
        username,
        temp_password: temp || '(existing — unchanged)',
        email: existing?.contact_email || '',
      });
    }

    // Write CSV (only rows we touched).
    if (!DRY_RUN && issued.length > 0) {
      fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
      const header = ['org', 'winery_id', 'username', 'temp_password', 'email'];
      const lines = [header.join(',')];
      for (const r of issued) lines.push(header.map((h) => csvCell(r[h])).join(','));
      fs.writeFileSync(OUT_PATH, lines.join('\n') + '\n');
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}orgs=${orgs.length} · accounts created=${created} · ` +
      `usernames assigned=${usernamed} · passwords set=${passworded} · unchanged=${skipped}`
    );
    if (!DRY_RUN && issued.length > 0) {
      console.log(`Wrote ${issued.length} credentials → ${OUT_PATH}`);
      console.log('⚠ Contains plaintext temp passwords — distribute securely, do not commit.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('generate-portal-credentials failed:', err);
  process.exit(1);
});
