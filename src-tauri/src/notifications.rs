use crate::vault::VaultRuntime;
use chrono::{Datelike, Duration, NaiveDate};
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const MAX_PENDING_NOTIFICATIONS: usize = 50;
const GENERIC_TITLE: &str = "Folio 财务提醒";
const GENERIC_BODY: &str = "有一项财务事项需要处理。打开 Folio 并解锁查看。";
const TITLE_BODY: &str = "打开 Folio 并解锁查看详情。";

#[derive(Clone, Debug, PartialEq)]
struct ReminderCandidate {
    id: String,
    title: String,
    due_on: String,
    advance_seconds: i64,
    updated_at: String,
}

#[derive(Clone, Debug, PartialEq)]
struct NotificationPlan {
    reminder_id: String,
    identifier: String,
    date: NaiveDate,
    hour: u32,
    title: String,
    body: String,
    reminder_version: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Authorization {
    Unsupported,
    NotDetermined,
    Denied,
    Authorized,
    Provisional,
    Ephemeral,
}

impl Authorization {
    fn label(self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::NotDetermined => "not_determined",
            Self::Denied => "denied",
            Self::Authorized => "authorized",
            Self::Provisional => "provisional",
            Self::Ephemeral => "ephemeral",
        }
    }

    fn can_schedule(self) -> bool {
        matches!(self, Self::Authorized | Self::Provisional | Self::Ephemeral)
    }
}

trait NotificationPlatform {
    fn authorization(&self) -> Authorization;
    fn request_authorization(&self) -> Result<bool, String>;
    fn schedule(&self, plan: &NotificationPlan) -> Result<(), String>;
    fn cancel(&self, identifier: &str);
}

struct SystemNotificationPlatform;

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple {
    use std::ffi::{c_char, CStr, CString};

    unsafe extern "C" {
        fn folio_notifications_initialize();
        fn folio_notifications_authorization_status() -> i32;
        fn folio_notifications_request_authorization(error_out: *mut *mut c_char) -> i32;
        fn folio_notifications_schedule(
            identifier: *const c_char,
            year: i32,
            month: i32,
            day: i32,
            hour: i32,
            title: *const c_char,
            body: *const c_char,
            error_out: *mut *mut c_char,
        ) -> i32;
        fn folio_notifications_cancel(identifier: *const c_char);
        fn folio_notifications_free_string(value: *mut c_char);
    }

    pub(super) fn initialize() {
        unsafe { folio_notifications_initialize() }
    }

    pub(super) fn status() -> i32 {
        unsafe { folio_notifications_authorization_status() }
    }

    fn result_with_error(call: impl FnOnce(*mut *mut c_char) -> i32) -> Result<i32, String> {
        let mut error = std::ptr::null_mut();
        let result = call(&mut error);
        if result >= 0 {
            return Ok(result);
        }
        let message = if error.is_null() {
            "System notification operation failed.".to_owned()
        } else {
            let value = unsafe { CStr::from_ptr(error) }
                .to_string_lossy()
                .into_owned();
            unsafe { folio_notifications_free_string(error) };
            value
        };
        Err(message)
    }

    pub(super) fn request() -> Result<bool, String> {
        result_with_error(|error| unsafe { folio_notifications_request_authorization(error) })
            .map(|value| value == 1)
    }

    pub(super) fn schedule(
        identifier: &str,
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        title: &str,
        body: &str,
    ) -> Result<(), String> {
        let identifier = CString::new(identifier).map_err(|_| "Invalid notification ID.")?;
        let title = CString::new(title).map_err(|_| "Invalid notification title.")?;
        let body = CString::new(body).map_err(|_| "Invalid notification body.")?;
        result_with_error(|error| unsafe {
            folio_notifications_schedule(
                identifier.as_ptr(),
                year,
                month as i32,
                day as i32,
                hour as i32,
                title.as_ptr(),
                body.as_ptr(),
                error,
            )
        })
        .map(|_| ())
    }

    pub(super) fn cancel(identifier: &str) {
        if let Ok(identifier) = CString::new(identifier) {
            unsafe { folio_notifications_cancel(identifier.as_ptr()) };
        }
    }
}

pub(crate) fn initialize() {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    apple::initialize();
}

impl NotificationPlatform for SystemNotificationPlatform {
    fn authorization(&self) -> Authorization {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            return match apple::status() {
                0 => Authorization::NotDetermined,
                1 => Authorization::Denied,
                2 => Authorization::Authorized,
                3 => Authorization::Provisional,
                4 => Authorization::Ephemeral,
                _ => Authorization::Unsupported,
            };
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        Authorization::Unsupported
    }

    fn request_authorization(&self) -> Result<bool, String> {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            return apple::request();
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        Err("System notifications are unavailable on this platform.".to_owned())
    }

    fn schedule(&self, plan: &NotificationPlan) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            return apple::schedule(
                &plan.identifier,
                plan.date.year(),
                plan.date.month(),
                plan.date.day(),
                plan.hour,
                &plan.title,
                &plan.body,
            );
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            let _ = plan;
            Err("System notifications are unavailable on this platform.".to_owned())
        }
    }

    fn cancel(&self, identifier: &str) {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        apple::cancel(identifier);
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        let _ = identifier;
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableNotificationRequest {
    privacy_mode: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisableNotificationRequest {
    confirmed_by_user: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStatusResponse {
    supported: bool,
    permission: &'static str,
    enabled: bool,
    privacy_mode: String,
    delivery_hour: i64,
    scheduled_count: i64,
    next_scheduled_at: Option<String>,
}

fn notification_identifier(candidate: &ReminderCandidate, date: NaiveDate, hour: u32) -> String {
    let digest = Sha256::digest(format!(
        "{}|{}|{}|{}|{}",
        candidate.id, date, candidate.advance_seconds, candidate.updated_at, hour
    ));
    format!("folio-{}", hex::encode(&digest[..16]))
}

fn plans_for(
    candidates: Vec<ReminderCandidate>,
    privacy_mode: &str,
    hour: u32,
    today: NaiveDate,
    current_hour: u32,
) -> Vec<NotificationPlan> {
    let mut plans = candidates
        .into_iter()
        .filter_map(|candidate| {
            let due = NaiveDate::parse_from_str(&candidate.due_on, "%Y-%m-%d").ok()?;
            let days = candidate.advance_seconds / 86_400;
            let date = due.checked_sub_signed(Duration::days(days))?;
            if date < today || (date == today && hour <= current_hour) {
                return None;
            }
            let identifier = notification_identifier(&candidate, date, hour);
            let title = if privacy_mode == "title" {
                candidate.title.clone()
            } else {
                GENERIC_TITLE.to_owned()
            };
            Some(NotificationPlan {
                reminder_id: candidate.id,
                identifier,
                date,
                hour,
                title,
                body: if privacy_mode == "title" {
                    TITLE_BODY.to_owned()
                } else {
                    GENERIC_BODY.to_owned()
                },
                reminder_version: candidate.updated_at,
            })
        })
        .collect::<Vec<_>>();
    plans.sort_by_key(|plan| (plan.date, plan.hour, plan.reminder_id.clone()));
    plans.truncate(MAX_PENDING_NOTIFICATIONS);
    plans
}

fn preferences(connection: &Connection, vault_id: &str) -> Result<(bool, String, i64), String> {
    connection
        .query_row(
            "SELECT enabled, privacy_mode, delivery_hour
             FROM notification_preferences WHERE vault_id = ?1",
            [vault_id],
            |row| Ok((row.get::<_, i64>(0)? == 1, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| "Unable to read private notification preferences.".to_owned())
        .map(|value| value.unwrap_or((false, "generic".to_owned(), 9)))
}

fn status_at(
    connection: &Connection,
    vault_id: &str,
    authorization: Authorization,
) -> Result<NotificationStatusResponse, String> {
    let (enabled, privacy_mode, delivery_hour) = preferences(connection, vault_id)?;
    let (scheduled_count, next_scheduled_at): (i64, Option<String>) = connection
        .query_row(
            "SELECT count(*), min(scheduled_for_local)
             FROM notification_schedules WHERE vault_id = ?1",
            [vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Unable to read private notification schedule.".to_owned())?;
    Ok(NotificationStatusResponse {
        supported: authorization != Authorization::Unsupported,
        permission: authorization.label(),
        enabled,
        privacy_mode,
        delivery_hour,
        scheduled_count,
        next_scheduled_at,
    })
}

fn clear_schedules(
    connection: &Connection,
    vault_id: &str,
    platform: &impl NotificationPlatform,
) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT request_identifier FROM notification_schedules WHERE vault_id = ?1")
        .map_err(|_| "Unable to inspect private notification schedule.".to_owned())?;
    let identifiers = statement
        .query_map([vault_id], |row| row.get::<_, String>(0))
        .map_err(|_| "Unable to inspect private notification schedule.".to_owned())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Unable to inspect private notification schedule.".to_owned())?;
    drop(statement);
    for identifier in identifiers {
        platform.cancel(&identifier);
    }
    connection
        .execute(
            "DELETE FROM notification_schedules WHERE vault_id = ?1",
            [vault_id],
        )
        .map_err(|_| "Unable to clear private notification schedule.".to_owned())?;
    Ok(())
}

fn reconcile_at(
    connection: &mut Connection,
    vault_id: &str,
    platform: &impl NotificationPlatform,
    today: NaiveDate,
    current_hour: u32,
) -> Result<NotificationStatusResponse, String> {
    let authorization = platform.authorization();
    let (enabled, privacy_mode, delivery_hour) = preferences(connection, vault_id)?;
    if !enabled || !authorization.can_schedule() {
        clear_schedules(connection, vault_id, platform)?;
        return status_at(connection, vault_id, authorization);
    }

    let candidates = {
        let mut statement = connection
            .prepare(
                "SELECT id, title, due_at, advance_seconds, updated_at
                 FROM reminders
                 WHERE vault_id = ?1 AND archived_at IS NULL
                   AND status IN ('active', 'snoozed')
                 ORDER BY due_at, id",
            )
            .map_err(|_| "Unable to read reminders for private notifications.".to_owned())?;
        let rows = statement
            .query_map([vault_id], |row| {
                Ok(ReminderCandidate {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    due_on: row.get(2)?,
                    advance_seconds: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|_| "Unable to read reminders for private notifications.".to_owned())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Unable to read reminders for private notifications.".to_owned())?;
        rows
    };
    let plans = plans_for(
        candidates,
        &privacy_mode,
        delivery_hour as u32,
        today,
        current_hour,
    );
    let existing = {
        let mut statement = connection
            .prepare(
                "SELECT reminder_id, request_identifier
                 FROM notification_schedules WHERE vault_id = ?1",
            )
            .map_err(|_| "Unable to inspect private notification schedule.".to_owned())?;
        let rows = statement
            .query_map([vault_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| "Unable to inspect private notification schedule.".to_owned())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|_| "Unable to inspect private notification schedule.".to_owned())?;
        rows
    };
    let desired_ids = plans
        .iter()
        .map(|plan| plan.reminder_id.as_str())
        .collect::<HashSet<_>>();
    for (reminder_id, identifier) in &existing {
        if !desired_ids.contains(reminder_id.as_str()) {
            platform.cancel(identifier);
            connection
                .execute(
                    "DELETE FROM notification_schedules
                     WHERE vault_id = ?1 AND reminder_id = ?2",
                    params![vault_id, reminder_id],
                )
                .map_err(|_| "Unable to update private notification schedule.".to_owned())?;
        }
    }
    for plan in &plans {
        if let Some(old_identifier) = existing.get(&plan.reminder_id) {
            if old_identifier != &plan.identifier {
                platform.cancel(old_identifier);
            }
        }
        platform.schedule(plan)?;
        let scheduled = format!("{}T{:02}:00:00", plan.date, plan.hour);
        connection
            .execute(
                "INSERT INTO notification_schedules(
                    vault_id, reminder_id, request_identifier, scheduled_for_local,
                    content_mode, reminder_version, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(vault_id, reminder_id) DO UPDATE SET
                    request_identifier = excluded.request_identifier,
                    scheduled_for_local = excluded.scheduled_for_local,
                    content_mode = excluded.content_mode,
                    reminder_version = excluded.reminder_version,
                    updated_at = excluded.updated_at",
                params![
                    vault_id,
                    plan.reminder_id,
                    plan.identifier,
                    scheduled,
                    privacy_mode,
                    plan.reminder_version
                ],
            )
            .map_err(|_| "Unable to persist private notification schedule.".to_owned())?;
    }
    status_at(connection, vault_id, authorization)
}

fn local_now(connection: &Connection) -> Result<(NaiveDate, u32), String> {
    let (date, hour): (String, u32) = connection
        .query_row(
            "SELECT date('now', 'localtime'),
                    CAST(strftime('%H', 'now', 'localtime') AS INTEGER)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Unable to read local notification time.".to_owned())?;
    NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map(|date| (date, hour))
        .map_err(|_| "Unable to parse local notification time.".to_owned())
}

fn audit_preference(
    connection: &Connection,
    vault_id: &str,
    action: &str,
    privacy_mode: &str,
) -> Result<(), String> {
    let mut random = [0_u8; 16];
    fill(&mut random).map_err(|_| "Unable to create notification audit ID.".to_owned())?;
    let id = format!("audit-{}", hex::encode(random));
    connection
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id,
                object_type, object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'security', ?3, 'local_user',
                'notification_preferences', ?2, json_object('privacyMode', ?4),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![id, vault_id, action, privacy_mode],
        )
        .map_err(|_| "Unable to append notification preference audit.".to_owned())?;
    Ok(())
}

#[tauri::command]
pub fn notification_status(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<NotificationStatusResponse, String> {
    let platform = SystemNotificationPlatform;
    runtime.with_unlocked_connection(|vault_id, connection| {
        status_at(connection, vault_id, platform.authorization())
    })
}

#[tauri::command]
pub fn notification_enable(
    request: EnableNotificationRequest,
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<NotificationStatusResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit confirmation is required before enabling notifications.".to_owned());
    }
    if !matches!(request.privacy_mode.as_str(), "generic" | "title") {
        return Err("Notification privacy mode is invalid.".to_owned());
    }
    let platform = SystemNotificationPlatform;
    let mut authorization = platform.authorization();
    if authorization == Authorization::Unsupported {
        return Err("System notifications are unavailable on this device.".to_owned());
    }
    if authorization == Authorization::NotDetermined {
        if !platform.request_authorization()? {
            return Err("Notification permission was not granted.".to_owned());
        }
        authorization = platform.authorization();
    }
    if !authorization.can_schedule() {
        return Err("Notification permission is denied in system settings.".to_owned());
    }
    runtime.with_unlocked_connection(|vault_id, connection| {
        connection
            .execute(
                "INSERT INTO notification_preferences(
                    vault_id, enabled, privacy_mode, delivery_hour, updated_at
                 ) VALUES (?1, 1, ?2, 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(vault_id) DO UPDATE SET
                    enabled = 1, privacy_mode = excluded.privacy_mode,
                    updated_at = excluded.updated_at",
                params![vault_id, request.privacy_mode],
            )
            .map_err(|_| "Unable to save private notification preferences.".to_owned())?;
        audit_preference(
            connection,
            vault_id,
            "local_notifications_enabled",
            &request.privacy_mode,
        )?;
        let (today, hour) = local_now(connection)?;
        reconcile_at(connection, vault_id, &platform, today, hour)
    })
}

#[tauri::command]
pub fn notification_disable(
    request: DisableNotificationRequest,
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<NotificationStatusResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit confirmation is required before disabling notifications.".to_owned());
    }
    let platform = SystemNotificationPlatform;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let (_, privacy_mode, _) = preferences(connection, vault_id)?;
        connection
            .execute(
                "INSERT INTO notification_preferences(
                    vault_id, enabled, privacy_mode, delivery_hour, updated_at
                 ) VALUES (?1, 0, ?2, 9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(vault_id) DO UPDATE SET
                    enabled = 0, updated_at = excluded.updated_at",
                params![vault_id, privacy_mode],
            )
            .map_err(|_| "Unable to save private notification preferences.".to_owned())?;
        audit_preference(
            connection,
            vault_id,
            "local_notifications_disabled",
            &privacy_mode,
        )?;
        let (today, hour) = local_now(connection)?;
        reconcile_at(connection, vault_id, &platform, today, hour)
    })
}

#[tauri::command]
pub fn notification_reconcile(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<NotificationStatusResponse, String> {
    let platform = SystemNotificationPlatform;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let (today, hour) = local_now(connection)?;
        reconcile_at(connection, vault_id, &platform, today, hour)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakePlatform {
        authorization: RefCell<Option<Authorization>>,
        scheduled: RefCell<Vec<NotificationPlan>>,
        cancelled: RefCell<Vec<String>>,
    }

    impl FakePlatform {
        fn authorized() -> Self {
            Self {
                authorization: RefCell::new(Some(Authorization::Authorized)),
                ..Self::default()
            }
        }
    }

    impl NotificationPlatform for FakePlatform {
        fn authorization(&self) -> Authorization {
            self.authorization
                .borrow()
                .unwrap_or(Authorization::NotDetermined)
        }
        fn request_authorization(&self) -> Result<bool, String> {
            Ok(false)
        }
        fn schedule(&self, plan: &NotificationPlan) -> Result<(), String> {
            self.scheduled.borrow_mut().push(plan.clone());
            Ok(())
        }
        fn cancel(&self, identifier: &str) {
            self.cancelled.borrow_mut().push(identifier.to_owned());
        }
    }

    fn candidate(id: &str, title: &str, due_on: &str, advance_days: i64) -> ReminderCandidate {
        ReminderCandidate {
            id: id.to_owned(),
            title: title.to_owned(),
            due_on: due_on.to_owned(),
            advance_seconds: advance_days * 86_400,
            updated_at: "2026-07-27T10:00:00Z".to_owned(),
        }
    }

    #[test]
    fn generic_plan_never_contains_financial_content() {
        let plans = plans_for(
            vec![candidate("r1", "招商银行房租 ¥8,000", "2026-08-10", 3)],
            "generic",
            9,
            NaiveDate::from_ymd_opt(2026, 7, 27).unwrap(),
            8,
        );
        assert_eq!(plans[0].title, GENERIC_TITLE);
        assert_eq!(plans[0].body, GENERIC_BODY);
        assert!(!plans[0].identifier.contains("r1"));
        assert!(!plans[0].title.contains("招商"));
        assert!(!plans[0].body.contains("8,000"));
    }

    #[test]
    fn title_mode_reveals_only_the_explicit_title() {
        let plans = plans_for(
            vec![candidate("r1", "保险续费", "2026-08-10", 0)],
            "title",
            9,
            NaiveDate::from_ymd_opt(2026, 7, 27).unwrap(),
            8,
        );
        assert_eq!(plans[0].title, "保险续费");
        assert_eq!(plans[0].body, TITLE_BODY);
    }

    #[test]
    fn advance_date_crosses_month_and_leap_day_correctly() {
        let plans = plans_for(
            vec![candidate("r1", "事项", "2028-03-01", 2)],
            "generic",
            9,
            NaiveDate::from_ymd_opt(2028, 2, 1).unwrap(),
            8,
        );
        assert_eq!(plans[0].date, NaiveDate::from_ymd_opt(2028, 2, 28).unwrap());
    }

    #[test]
    fn missed_times_are_not_scheduled_immediately() {
        let plans = plans_for(
            vec![
                candidate("past", "过去", "2026-07-26", 0),
                candidate("today", "今天", "2026-07-27", 0),
                candidate("future", "未来", "2026-07-28", 0),
            ],
            "generic",
            9,
            NaiveDate::from_ymd_opt(2026, 7, 27).unwrap(),
            10,
        );
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].reminder_id, "future");
    }

    #[test]
    fn scheduling_is_capped_at_fifty_upcoming_items() {
        let candidates = (0..60)
            .map(|index| candidate(&format!("r{index:02}"), "事项", "2026-08-10", 0))
            .collect();
        let plans = plans_for(
            candidates,
            "generic",
            9,
            NaiveDate::from_ymd_opt(2026, 7, 27).unwrap(),
            8,
        );
        assert_eq!(plans.len(), MAX_PENDING_NOTIFICATIONS);
    }

    #[test]
    fn denied_permission_fails_closed_and_clears_derived_schedule() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .unwrap();
        connection
            .execute(
                "INSERT INTO vaults(id,display_name,base_currency,created_at)
             VALUES('v1','V','CNY','now')",
                [],
            )
            .unwrap();
        connection.execute(
            "INSERT INTO notification_preferences(vault_id,enabled,privacy_mode,delivery_hour,updated_at)
             VALUES('v1',1,'generic',9,'now')",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO reminders(id,vault_id,category,title,due_at,status,created_at,updated_at)
             VALUES('r1','v1','custom','秘密','2026-08-10','active','now','v1')",
            [],
        ).unwrap();
        connection
            .execute(
                "INSERT INTO notification_schedules(
               vault_id,reminder_id,request_identifier,scheduled_for_local,
               content_mode,reminder_version,updated_at)
             VALUES('v1','r1','old','2026-08-10T09:00:00','generic','v1','now')",
                [],
            )
            .unwrap();
        let platform = FakePlatform {
            authorization: RefCell::new(Some(Authorization::Denied)),
            ..FakePlatform::default()
        };
        let mut connection = connection;
        let status = reconcile_at(
            &mut connection,
            "v1",
            &platform,
            NaiveDate::from_ymd_opt(2026, 7, 27).unwrap(),
            8,
        )
        .unwrap();
        assert_eq!(status.permission, "denied");
        assert_eq!(status.scheduled_count, 0);
        assert_eq!(platform.cancelled.borrow().as_slice(), ["old"]);
        assert!(platform.scheduled.borrow().is_empty());
    }

    #[test]
    fn repeated_reconcile_replaces_stable_identifier_without_duplicates_in_db() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .unwrap();
        connection
            .execute(
                "INSERT INTO vaults(id,display_name,base_currency,created_at)
             VALUES('v1','V','CNY','now')",
                [],
            )
            .unwrap();
        connection.execute(
            "INSERT INTO notification_preferences(vault_id,enabled,privacy_mode,delivery_hour,updated_at)
             VALUES('v1',1,'generic',9,'now')",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO reminders(id,vault_id,category,title,due_at,status,created_at,updated_at)
             VALUES('r1','v1','custom','事项','2026-08-10','active','now','v1')",
            [],
        ).unwrap();
        let platform = FakePlatform::authorized();
        let mut connection = connection;
        for _ in 0..2 {
            reconcile_at(
                &mut connection,
                "v1",
                &platform,
                NaiveDate::from_ymd_opt(2026, 7, 27).unwrap(),
                8,
            )
            .unwrap();
        }
        let count: i64 = connection
            .query_row("SELECT count(*) FROM notification_schedules", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(
            platform.scheduled.borrow()[0].identifier,
            platform.scheduled.borrow()[1].identifier
        );
    }
}
