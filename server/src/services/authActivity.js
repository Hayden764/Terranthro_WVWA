import { pool } from '../db/pool.js';

export async function logAuthEvent({
  accountId = null,
  wineryId = null,
  identifier = null,
  actorAdminId = null,
  eventType,
  success = true,
  details = {},
  ip = null,
  userAgent = null,
}) {
  if (!eventType) return;

  try {
    await pool.query(
      `INSERT INTO auth_activity_log
         (account_id, winery_id, identifier, actor_admin_id, event_type, success, details, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        accountId,
        wineryId,
        identifier,
        actorAdminId,
        eventType,
        Boolean(success),
        details,
        ip,
        userAgent,
      ]
    );
  } catch (err) {
    console.error('Auth activity log error:', err);
  }
}