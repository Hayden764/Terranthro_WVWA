/**
 * seed-owb-contract.mjs
 * =====================
 * Seeds the OWB Portal (migration 030): the shared OWB login, the signed
 * contract, and its payment schedule — build-phase hosting plus the 16
 * milestones, with scope and amounts copied from Exhibit A of the
 * DOJ-approved contract (v2026.09.30 v2, approved 2026-10-01).
 *
 * Safe to re-run: the account and contract are upserted by slug, and the
 * milestones/tasks are only inserted when the contract has none, so progress
 * already recorded is never overwritten.
 *
 * The first run (or --reset-password) sets a random temporary password and
 * prints it once to this terminal — send it to OWB directly. OWB is asked to
 * change it on first sign-in.
 *
 * Requires DATABASE_URL (loaded from server/.env via db/pool.js).
 *
 * Usage (from server/):
 *   node scripts/seed-owb-contract.mjs [--reset-password] [--dry-run]
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';

const args = process.argv.slice(2);
const RESET_PASSWORD = args.includes('--reset-password');
const DRY_RUN = args.includes('--dry-run');

const CLIENT = {
  slug: 'owb',
  name: 'Oregon Wine Board',
  username: 'owb',
  // Agency's Contract Administrator (contract §1).
  notifyEmails: ['sally@oregonwine.org'],
};

const CONTRACT = {
  slug: 'owb-statewide-vineyard-mapping',
  title: 'Oregon Statewide Vineyard Mapping',
  nteAmount: 141800,
};

const WV_SUB_AVAS = [
  'Chehalem Mountains', 'Dundee Hills', 'Eola-Amity Hills', 'Laurelwood District',
  'Lower Long Tom', 'McMinnville', 'Mt. Pisgah, Polk County', 'Ribbon Ridge',
  'Tualatin Hills', 'Van Duzer Corridor', 'Yamhill-Carlton',
];

const TERRAIN_CLIMATE = 'Terrain + climate attributes added';

// [number, title, work, base, additional, additionalLabel, dueLabel, targetDate, tasks]
const SCHEDULE = [
  [null, 'Build-phase hosting (12 months)',
    'Hosting of the Public Atlas and OWB Portal through the build phase. Invoiced at contract execution.',
    4800, 0, null, 'Upon contract execution', null, []],
  [1, 'Kickoff + calibration + OWB Portal',
    'Method document (includes accuracy assessment sample design), calibration, and tracking board using 2024 OSIP data. OWB Portal opens so OWB can follow progress and access data as each milestone is delivered.',
    5000, 0, null, 'Upon contract execution', null,
    ['Method document (incl. accuracy assessment sample design)', 'Calibration on 2024 OSIP imagery', 'Tracking board', 'OWB Portal opens']],
  [2, 'Willamette Valley sub-AVAs: 2024',
    'Refresh 2024 boundaries for all Willamette Valley sub-AVAs; add terrain and climate attributes.',
    7000, 2500, 'terrain + climate', 'November 2026', '2026-11-30',
    [...WV_SUB_AVAS, TERRAIN_CLIMATE]],
  [3, 'Willamette Valley non-nested parent: 2024',
    'Delineate all remaining Willamette Valley vineyards at 2024; add terrain and climate attributes.',
    6000, 2500, 'terrain + climate', 'December 2026', '2026-12-31',
    ['Delineate remaining Willamette Valley vineyards', TERRAIN_CLIMATE]],
  [4, 'Willamette Valley: historical',
    'Finish 2022 and map 2020 against the 2024 boundaries.',
    5000, 0, null, 'January 2027', '2027-01-31',
    ['2022 mapping', '2020 mapping']],
  [5, 'Willamette Valley: naming',
    "Name blocks using existing mapping, online sources, and grower meetings; blocks that can't be named yet go to spring field verification.",
    7000, 0, null, 'January 2027', '2027-01-31',
    ['Name from existing mapping + online sources', 'Grower meetings', 'Unresolved blocks flagged for field verification']],
  [6, 'Southern Oregon: 2024',
    'Umpqua Valley, Rogue Valley, Applegate Valley, Elkton and Red Hill: delineate at 2024; add terrain and climate attributes.',
    10500, 2000, 'terrain + climate', 'February 2027', '2027-02-28',
    ['Umpqua Valley', 'Elkton Oregon', 'Red Hill Douglas County', 'Rogue Valley', 'Applegate Valley', TERRAIN_CLIMATE]],
  [7, 'Southern Oregon: historical',
    'Map 2022 and 2020 against the 2024 boundaries.',
    7000, 0, null, 'March 2027', '2027-03-31',
    ['2022 mapping', '2020 mapping']],
  [8, 'Southern Oregon: naming',
    "Name vineyards, building from existing mapping, online sources, and grower meetings; blocks that can't be named yet go to spring field verification.",
    7000, 0, null, 'March 2027', '2027-03-31',
    ['Name from existing mapping + online sources', 'Grower meetings', 'Unresolved blocks flagged for field verification']],
  [9, 'Columbia Gorge, Columbia Valley + Walla Walla Valley: 2024',
    'Delineate at 2024, including The Rocks District of Milton-Freewater; add terrain and climate attributes.',
    5000, 1000, 'terrain + climate', 'March 2027', '2027-03-31',
    ['Columbia Gorge', 'Columbia Valley', 'Walla Walla Valley', 'The Rocks District of Milton-Freewater', TERRAIN_CLIMATE]],
  [10, 'Columbia Gorge, Columbia Valley + Walla Walla Valley: historical',
    'Map 2022 and 2020 against the 2024 boundaries.',
    3000, 0, null, 'April 2027', '2027-04-30',
    ['2022 mapping', '2020 mapping']],
  [11, 'Columbia Gorge, Columbia Valley + Walla Walla Valley: naming',
    "Name blocks using existing historical mapping, online sources, and grower meetings; blocks that can't be named yet go to spring field verification.",
    3500, 0, null, 'April 2027', '2027-04-30',
    ['Name from existing mapping + online sources', 'Grower meetings', 'Unresolved blocks flagged for field verification']],
  [12, 'Remaining Eastern Oregon + plantings outside designated AVAs',
    'Snake River Valley and plantings outside designated AVAs: 2024 delineation, 2022/2020 historical mapping, naming; add terrain and climate attributes.',
    9000, 1000, 'terrain + climate', 'May 2027', '2027-05-31',
    ['Snake River Valley', 'Plantings outside designated AVAs', '2022 + 2020 historical mapping', 'Naming', TERRAIN_CLIMATE]],
  [13, 'Spring field verification',
    'Statewide field campaign: collect the accuracy assessment sample, confirm that unresolved blocks exist, verify names.',
    10000, 0, null, 'April–June 2027', '2027-06-30',
    ['Accuracy assessment sample collected', 'Unresolved blocks confirmed', 'Names verified']],
  [14, 'Soils',
    'Statewide SSURGO soil data for every block: map unit composition by area percentage, dominant soil series, and drainage class and available water capacity where available. Blocks that span several map units get area-weighted composition.',
    0, 8000, 'soils', 'May 2027', '2027-05-31',
    []],
  [15, 'OSIP 2026 statewide update',
    'Compare 2024 and 2026 imagery statewide, update all blocks to 2026, and re-run terrain, climate and soils attributes on the updated boundaries.',
    22000, 0, null, 'Upon 2026 OSIP release', null,
    ['2026 OSIP imagery released', 'Blocks updated to 2026', 'Terrain, climate + soils re-run']],
  [16, 'Atlas publish + Grower Enrichment Portal opens',
    'Publish the Public Atlas on 2026 boundaries; open the Grower Enrichment Portal for data entry; deliver the accuracy assessment report, documentation, full data export, final QA, and a planning discussion for future updates.',
    3000, 10000, 'Grower Enrichment Portal', 'Upon completion of all other steps', null,
    ['Public Atlas published', 'Grower Enrichment Portal opens', 'Grower portal terms of use approved by OWB', 'Accuracy assessment report', 'Documentation + full data export', 'Final QA', 'Future-updates planning discussion']],
];

// Unambiguous alphabet (no 0/O/1/l/I) for a human-typable temp password.
function tempPassword(length = 14) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function main() {
  const total = SCHEDULE.reduce((s, row) => s + row[3] + row[4], 0);
  if (total !== CONTRACT.nteAmount) {
    throw new Error(`Schedule totals $${total}, expected $${CONTRACT.nteAmount}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [account] } = await client.query(
      `INSERT INTO client_accounts (slug, name, username, notify_emails)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, password_hash IS NOT NULL AS has_password`,
      [CLIENT.slug, CLIENT.name, CLIENT.username, CLIENT.notifyEmails]
    );

    let issuedPassword = null;
    if (!account.has_password || RESET_PASSWORD) {
      issuedPassword = tempPassword();
      const hash = await bcrypt.hash(issuedPassword, 12);
      await client.query(
        `UPDATE client_accounts SET password_hash = $1, password_must_change = TRUE WHERE id = $2`,
        [hash, account.id]
      );
    }

    const { rows: [contract] } = await client.query(
      `INSERT INTO contracts (client_account_id, slug, title, nte_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, nte_amount = EXCLUDED.nte_amount
       RETURNING id`,
      [account.id, CONTRACT.slug, CONTRACT.title, CONTRACT.nteAmount]
    );

    const { rows: [{ n }] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM contract_milestones WHERE contract_id = $1`,
      [contract.id]
    );

    if (n === 0) {
      for (const [i, [number, title, work, base, additional, additionalLabel, dueLabel, targetDate, tasks]] of SCHEDULE.entries()) {
        const { rows: [m] } = await client.query(
          `INSERT INTO contract_milestones
             (contract_id, kind, number, sort_order, title, work, base_amount,
              additional_amount, additional_label, due_label, target_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [contract.id, number == null ? 'hosting' : 'milestone', number, i, title, work,
           base, additional, additionalLabel, dueLabel, targetDate]
        );
        for (const [j, label] of tasks.entries()) {
          await client.query(
            `INSERT INTO contract_tasks (milestone_id, label, sort_order) VALUES ($1, $2, $3)`,
            [m.id, label, j]
          );
        }
      }
      console.log(`Inserted ${SCHEDULE.length} schedule lines ($${total.toLocaleString()}).`);
    } else {
      console.log(`Contract already has ${n} schedule lines — left untouched.`);
    }

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('Dry run — rolled back.');
      return;
    }
    await client.query('COMMIT');

    if (issuedPassword) {
      console.log(`\nOWB Portal login — username: ${CLIENT.username}   temporary password: ${issuedPassword}`);
      console.log('Shown once. OWB will be asked to change it on first sign-in.\n');
    } else {
      console.log('Login already has a password (use --reset-password to issue a new one).');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
