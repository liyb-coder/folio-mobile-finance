function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export const DAILY_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1_000;

function validPersistedTimestamp(value, nowMs) {
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > nowMs) return null;
  return timestamp;
}

function firstValidPersistedTimestamp(values, nowMs) {
  for (const value of values) {
    const timestamp = validPersistedTimestamp(value, nowMs);
    if (timestamp != null) return timestamp;
  }
  return null;
}

function isInsideRollingWindow(timestamp, nowMs) {
  return timestamp != null && nowMs - timestamp < DAILY_CHANGE_WINDOW_MS;
}

function mark(statuses, id, status) {
  if (!id || statuses[id] === "new") return;
  statuses[id] = status;
}

export function deriveDailyChangeHighlights({
  accounts = [],
  holdings = [],
  holdingOperations = [],
  transactions = [],
  reminders = [],
  planning = null,
} = {}, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const todayKey = localDayKey(now);
  let nextExpiryMs = null;
  const result = {
    todayKey,
    nextExpiryAt: null,
    accounts: {},
    holdings: {},
    transactions: {},
    reminders: {},
    planning: null,
  };

  if (!Number.isFinite(nowMs)) return result;

  const recentTimestamp = (value) => {
    const timestamp = validPersistedTimestamp(value, nowMs);
    if (!isInsideRollingWindow(timestamp, nowMs)) return null;
    const expiry = timestamp + DAILY_CHANGE_WINDOW_MS;
    nextExpiryMs = nextExpiryMs == null ? expiry : Math.min(nextExpiryMs, expiry);
    return timestamp;
  };

  const recordStatus = (record) => {
    if (!record) return null;
    const creationTimestamp = firstValidPersistedTimestamp(
      [record.confirmedAt, record.createdAt],
      nowMs,
    );
    const creationIsRecent = creationTimestamp != null
      ? recentTimestamp(new Date(creationTimestamp)) != null
      : false;
    const updateIsRecent = recentTimestamp(record.updatedAt) != null;
    if (creationIsRecent) return "new";
    if (updateIsRecent) return "updated";
    return null;
  };

  for (const account of accounts) {
    const status = recordStatus(account);
    if (status) mark(result.accounts, account.id, status);
  }

  for (const holding of holdings) {
    const status = recordStatus(holding);
    if (status) mark(result.holdings, holding.id, status);
  }

  for (const operation of holdingOperations) {
    if (!recordStatus(operation)) continue;
    mark(result.holdings, operation.holdingId, "updated");
    mark(result.accounts, operation.holdingAccountId, "updated");
    mark(result.accounts, operation.settlementAccountId, "updated");
  }

  for (const transaction of transactions) {
    const status = recordStatus(transaction);
    if (!status) continue;
    mark(result.transactions, transaction.id, status);
    mark(result.accounts, transaction.accountId, "updated");
    mark(result.accounts, transaction.destinationAccountId, "updated");
  }

  for (const reminder of reminders) {
    const status = recordStatus(reminder);
    if (status) mark(result.reminders, reminder.id, status);
  }

  if (planning) {
    result.planning = recordStatus(planning);
  }

  result.nextExpiryAt = nextExpiryMs == null ? null : new Date(nextExpiryMs).toISOString();

  return result;
}

export function dailyChangeLabel(status) {
  return status === "new" ? "NEW · 新增" : status === "updated" ? "NEW · 更新" : "";
}
