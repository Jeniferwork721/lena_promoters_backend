const { pool } = require('../config/db');

/**
 * Returns a unique array of numeric team IDs that this staff user manages or belongs to.
 * Includes:
 * 1. Teams where lead_id = staffId
 * 2. Teams explicitly listed in staff_users.managed_teams JSON array
 * 3. The user's primary team_id
 */
async function getManagedTeamIds(staffId, staffUser = null) {
  if (!staffId) return [];
  const teamIds = new Set();
  let user = staffUser;

  if (!user || user.managed_teams === undefined) {
    try {
      const [rows] = await pool.query(
        'SELECT id, role, team_id, managed_teams FROM staff_users WHERE id = ? LIMIT 1',
        [staffId]
      );
      if (rows.length > 0) user = rows[0];
    } catch (_) {}
  }

  if (user) {
    // 1. Teams where this user is the registered team lead
    try {
      const [leadTeams] = await pool.query('SELECT id FROM teams WHERE lead_id = ?', [staffId]);
      for (const t of leadTeams) {
        if (t.id) teamIds.add(Number(t.id));
      }
    } catch (_) {}

    // 2. Teams explicitly assigned in managed_teams JSON array
    const rawManaged = user.managed_teams || user.managedTeams;
    if (rawManaged) {
      try {
        const parsed = typeof rawManaged === 'string' ? JSON.parse(rawManaged) : rawManaged;
        if (Array.isArray(parsed)) {
          for (const tid of parsed) {
            const num = Number(tid);
            if (!isNaN(num) && num > 0) teamIds.add(num);
          }
        }
      } catch (_) {}
    }

    // 3. If user is explicitly assigned as lead or has managed_teams, also include their own primary team_id if set
    if (teamIds.size > 0) {
      const ownTeamId = user.team_id || user.teamId;
      if (ownTeamId) {
        const num = Number(ownTeamId);
        if (!isNaN(num) && num > 0) teamIds.add(num);
      }
    }
  }

  return Array.from(teamIds);
}

/**
 * Returns an array of staff_users.id belonging to the given team IDs, plus the manager/staff user themselves.
 */
async function getManagedStaffIds(staffId, managedTeamIds) {
  const staffIds = new Set();
  if (staffId) staffIds.add(Number(staffId));
  if (Array.isArray(managedTeamIds) && managedTeamIds.length > 0) {
    try {
      const [members] = await pool.query(
        'SELECT id FROM staff_users WHERE team_id IN (?) AND is_active = 1',
        [managedTeamIds]
      );
      for (const m of members) {
        if (m.id) staffIds.add(Number(m.id));
      }
    } catch (_) {}
  }
  return Array.from(staffIds);
}

module.exports = {
  getManagedTeamIds,
  getManagedStaffIds,
};
