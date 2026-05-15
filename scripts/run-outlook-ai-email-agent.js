require('dotenv').config();

const db = require('../config/database');
const {
  getOutlookAgentStatus,
  syncOutlookInbox
} = require('../services/outlookAiEmailAgentService');

async function main() {
  const status = await getOutlookAgentStatus(db);
  const result = await syncOutlookInbox(db, {
    limit: status.maxMessages || 10,
    unreadOnly: status.pollUnreadOnly !== false,
    createGraphDraft: true
  });

  console.log(JSON.stringify({
    ok: result.ok,
    reason: result.reason || null,
    synced: result.synced || 0,
    drafted: Array.isArray(result.drafted) ? result.drafted.length : 0,
    mode: status.approvalMode,
    mailbox: status.mailbox || null
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => {});
  });
