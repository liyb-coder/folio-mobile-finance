use crate::{
    accounts::{
        account_snapshot, confirm_account_draft_at, create_account_draft_at,
        ConfirmAccountDraftRequest, CreateAccountDraftRequest,
    },
    database::open_encrypted,
    holdings::{
        confirm_holding_draft_at, create_holding_draft_at, holding_snapshot,
        ConfirmHoldingDraftRequest, CreateHoldingDraftRequest,
    },
    planning::{
        confirm_planning_draft_at, planning_snapshot, save_planning_draft_at,
        ConfirmPlanningDraftRequest, SavePlanningDraftRequest,
    },
    reminders::{
        confirm_reminder_draft_at, create_reminder_draft_at, reminder_snapshot,
        ConfirmReminderDraftRequest, CreateReminderDraftRequest,
    },
    transactions::{
        confirm_transaction_draft_at, create_transaction_draft_at, transaction_snapshot,
        ConfirmTransactionDraftRequest, CreateTransactionDraftRequest,
    },
    vault::VaultRuntime,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

fn decode<T: DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("test request should match native schema")
}

fn field<T: Serialize>(value: T, name: &str) -> String {
    serde_json::to_value(value)
        .expect("response should serialize")
        .get(name)
        .and_then(Value::as_str)
        .expect("response field should exist")
        .to_owned()
}

fn runtime_with_encrypted_vault() -> (tempfile::TempDir, VaultRuntime) {
    let directory = tempfile::tempdir().expect("temporary directory should exist");
    let connection = open_encrypted(&directory.path().join("cold-start.sqlite3"), &[73_u8; 32])
        .expect("encrypted database should open");
    connection
        .execute(
            "INSERT INTO vaults(id, display_name, base_currency, created_at)
             VALUES ('vault-1', 'Folio cold start', 'CNY', '2026-05-31T00:00:00.000Z')",
            [],
        )
        .expect("vault fixture should insert");
    let runtime = VaultRuntime::default();
    runtime.install_test_session("vault-1", connection);
    (directory, runtime)
}

fn confirm_account(runtime: &VaultRuntime, request: Value) -> String {
    let draft = create_account_draft_at(runtime, decode::<CreateAccountDraftRequest>(request))
        .expect("account draft should validate");
    let draft_id = field(&draft, "draftId");
    let account_id = field(&draft, "accountId");
    confirm_account_draft_at(
        runtime,
        decode::<ConfirmAccountDraftRequest>(json!({
            "draftId": draft_id,
            "confirmedByUser": true
        })),
    )
    .expect("account should confirm");
    account_id
}

fn confirm_holding(runtime: &VaultRuntime, request: Value) {
    let draft = create_holding_draft_at(runtime, decode::<CreateHoldingDraftRequest>(request))
        .expect("holding draft should validate");
    confirm_holding_draft_at(
        runtime,
        decode::<ConfirmHoldingDraftRequest>(json!({
            "draftId": field(draft, "draftId"),
            "confirmedByUser": true
        })),
    )
    .expect("holding should confirm");
}

fn confirm_transaction(runtime: &VaultRuntime, request: Value) {
    let draft =
        create_transaction_draft_at(runtime, decode::<CreateTransactionDraftRequest>(request))
            .expect("transaction draft should validate");
    confirm_transaction_draft_at(
        runtime,
        decode::<ConfirmTransactionDraftRequest>(json!({
            "draftId": field(draft, "draftId"),
            "confirmedByUser": true
        })),
    )
    .expect("transaction should confirm");
}

fn confirm_reminder(runtime: &VaultRuntime, request: Value) {
    let draft = create_reminder_draft_at(runtime, decode::<CreateReminderDraftRequest>(request))
        .expect("reminder draft should validate");
    confirm_reminder_draft_at(
        runtime,
        decode::<ConfirmReminderDraftRequest>(json!({
            "draftId": field(draft, "draftId"),
            "confirmedByUser": true
        })),
    )
    .expect("reminder should confirm");
}

#[test]
fn fictional_markdown_cold_start_reaches_exact_sqlcipher_state() {
    let (_directory, runtime) = runtime_with_encrypted_vault();
    let account_fixtures = [
        (
            "salary",
            "招商银行",
            "工资账户",
            "cash",
            "CNY",
            "3619",
            "50780.00",
        ),
        (
            "daily",
            "建设银行",
            "日常账户",
            "cash",
            "CNY",
            "8208",
            "27208.52",
        ),
        (
            "card",
            "中信银行",
            "信用卡",
            "liability",
            "CNY",
            "1028",
            "-2920.25",
        ),
        (
            "invest",
            "蚂蚁基金",
            "投资账户",
            "fund",
            "CNY",
            "F208",
            "385731.75",
        ),
        (
            "insurance",
            "平安保险",
            "保障账户",
            "insurance",
            "CNY",
            "P619",
            "120000.00",
        ),
        (
            "home",
            "虚构不动产登记",
            "自住房",
            "property",
            "CNY",
            "H001",
            "2080000.00",
        ),
        (
            "wealth",
            "工商银行",
            "银行理财账户",
            "investment",
            "CNY",
            "7790",
            "179140.00",
        ),
        (
            "mortgage",
            "建设银行",
            "住房按揭",
            "liability",
            "CNY",
            "5306",
            "-680000.00",
        ),
        (
            "usd",
            "招商银行",
            "美元储蓄",
            "savings",
            "USD",
            "6621",
            "12800.00",
        ),
    ];
    let mut account_ids = HashMap::new();
    for (key, institution, name, account_type, currency, suffix, opening_balance) in
        account_fixtures
    {
        let id = confirm_account(
            &runtime,
            json!({
                "institutionName": institution,
                "displayName": name,
                "accountType": account_type,
                "currency": currency,
                "maskedIdentifier": suffix,
                "openingBalance": opening_balance,
                "balanceDate": "2026-02-28",
                "notes": format!("虚构冷启动账户 {key}")
            }),
        );
        account_ids.insert(key, id);
    }

    let holding_fixtures = [
        (
            "invest",
            "虚构现金宝",
            "cash_management",
            "CNY",
            "86400",
            "86400.00",
            "86400.00",
        ),
        (
            "invest",
            "虚构稳健债券 A",
            "fixed_income",
            "CNY",
            "118520.35",
            "120000.00",
            "120300.00",
        ),
        (
            "invest",
            "虚构中证红利基金",
            "fund",
            "CNY",
            "93582.17",
            "110000.00",
            "118500.00",
        ),
        (
            "invest",
            "虚构黄金 ETF",
            "security",
            "CNY",
            "1360",
            "58000.00",
            "61200.00",
        ),
        (
            "insurance",
            "虚构终身寿险现金价值",
            "insurance",
            "CNY",
            "1",
            "108000.00",
            "120000.00",
        ),
        (
            "wealth",
            "虚构稳享 180 天",
            "fixed_income",
            "CNY",
            "1",
            "80000.00",
            "80000.00",
        ),
        (
            "wealth",
            "虚构挂钩黄金结构性存款",
            "fixed_income",
            "CNY",
            "1",
            "100000.00",
            "100000.00",
        ),
    ];
    for (account_key, name, product_type, currency, units, cost_basis, market_value) in
        holding_fixtures
    {
        confirm_holding(
            &runtime,
            json!({
                "accountId": account_ids[account_key],
                "name": name,
                "productType": product_type,
                "currency": currency,
                "maskedIdentifier": null,
                "units": units,
                "costBasis": cost_basis,
                "marketValue": market_value,
                "asOfDate": "2026-07-30",
                "notes": "虚构冷启动持仓"
            }),
        );
    }

    let transaction_fixtures = [
        (
            "2026-07-01",
            "income",
            "salary",
            None,
            "30000.00",
            "工资",
            "七月工资",
        ),
        (
            "2026-07-02",
            "transfer",
            "salary",
            Some("daily"),
            "10000.00",
            "账户调拨",
            "月度生活费",
        ),
        (
            "2026-07-03",
            "expense",
            "daily",
            None,
            "168.00",
            "交通",
            "高铁票",
        ),
        (
            "2026-07-05",
            "expense",
            "card",
            None,
            "258.60",
            "餐饮",
            "虚构餐厅",
        ),
        (
            "2026-07-08",
            "expense",
            "daily",
            None,
            "1200.00",
            "餐饮",
            "家庭聚餐",
        ),
        (
            "2026-07-12",
            "expense",
            "card",
            None,
            "368.00",
            "购物",
            "日用品",
        ),
        (
            "2026-07-15",
            "income",
            "daily",
            None,
            "8600.00",
            "租金",
            "七月租金",
        ),
        (
            "2026-07-18",
            "expense",
            "card",
            None,
            "1280.00",
            "保险",
            "年度保险复核款",
        ),
        (
            "2026-07-20",
            "expense",
            "daily",
            None,
            "960.00",
            "购物",
            "家居用品",
        ),
        (
            "2026-07-22",
            "transfer",
            "daily",
            Some("card"),
            "2800.00",
            "信用卡还款",
            "七月部分还款",
        ),
        (
            "2026-07-23",
            "expense",
            "daily",
            None,
            "6800.00",
            "住房",
            "七月房贷本息",
        ),
        (
            "2026-07-24",
            "income",
            "card",
            None,
            "86.50",
            "退款",
            "便利店重复扣款退款",
        ),
        (
            "2026-07-25",
            "income",
            "invest",
            None,
            "680.25",
            "投资收益",
            "红利基金现金分红",
        ),
        (
            "2026-07-26",
            "expense",
            "invest",
            None,
            "12.00",
            "投资费用",
            "基金销售服务费",
        ),
        (
            "2026-07-27",
            "expense",
            "daily",
            None,
            "1200.00",
            "法律服务",
            "虚构租赁纠纷咨询费",
        ),
        (
            "2026-07-28",
            "income",
            "wealth",
            None,
            "860.00",
            "理财收益",
            "稳享理财到期收益",
        ),
        (
            "2026-06-01",
            "income",
            "salary",
            None,
            "29500.00",
            "工资",
            "六月工资",
        ),
        (
            "2026-06-12",
            "expense",
            "card",
            None,
            "2688.00",
            "购物",
            "上月数码配件",
        ),
        (
            "2026-03-01",
            "income",
            "salary",
            None,
            "28000.00",
            "工资",
            "三月工资",
        ),
        (
            "2026-03-18",
            "expense",
            "daily",
            None,
            "4500.00",
            "住房",
            "三月家庭支出",
        ),
        (
            "2026-04-01",
            "income",
            "salary",
            None,
            "29000.00",
            "工资",
            "四月工资",
        ),
        (
            "2026-04-16",
            "expense",
            "daily",
            None,
            "6200.00",
            "住房",
            "四月家庭支出",
        ),
        (
            "2026-05-01",
            "income",
            "salary",
            None,
            "29500.00",
            "工资",
            "五月工资",
        ),
        (
            "2026-05-14",
            "expense",
            "card",
            None,
            "5300.00",
            "购物",
            "五月家庭采购",
        ),
        (
            "2026-08-01",
            "income",
            "salary",
            None,
            "30000.00",
            "工资",
            "八月工资",
        ),
        (
            "2026-08-13",
            "expense",
            "daily",
            None,
            "368.00",
            "购物",
            "八月日用品",
        ),
    ];
    for (date, kind, account_key, destination_key, amount, category, description) in
        transaction_fixtures
    {
        confirm_transaction(
            &runtime,
            json!({
                "transactionKind": kind,
                "accountId": account_ids[account_key],
                "destinationAccountId": destination_key.map(|key| account_ids[key].clone()),
                "amount": amount,
                "occurredOn": date,
                "description": description,
                "category": category,
                "notes": "虚构冷启动流水"
            }),
        );
    }

    let reminder_fixtures = [
        (
            "rent",
            "八月租金确认",
            Some("daily"),
            Some("8600.00"),
            "2026-08-15",
            3,
            Some("monthly"),
        ),
        (
            "insurance",
            "保单续期复核",
            Some("insurance"),
            Some("12800.00"),
            "2026-08-10",
            10,
            Some("yearly"),
        ),
        (
            "maturity",
            "稳健债券到期评估",
            Some("invest"),
            Some("120300.00"),
            "2026-09-18",
            15,
            None,
        ),
        (
            "repayment",
            "信用卡还款日",
            Some("card"),
            Some("4628.35"),
            "2026-08-08",
            3,
            Some("monthly"),
        ),
        (
            "investment",
            "红利基金月度定投",
            Some("invest"),
            Some("3000.00"),
            "2026-08-05",
            1,
            Some("monthly"),
        ),
        (
            "idle_cash",
            "活期安全垫检查",
            Some("salary"),
            Some("50000.00"),
            "2026-08-01",
            0,
            Some("monthly"),
        ),
        (
            "maturity",
            "结构性存款到期核对",
            Some("wealth"),
            Some("100000.00"),
            "2026-10-30",
            15,
            None,
        ),
        (
            "repayment",
            "住房按揭还款日",
            Some("mortgage"),
            Some("6800.00"),
            "2026-08-23",
            3,
            Some("monthly"),
        ),
        (
            "custom",
            "租赁纠纷材料提交",
            None,
            None,
            "2026-08-12",
            5,
            None,
        ),
    ];
    for (category, title, account_key, amount, due_on, advance_days, recurrence_rule) in
        reminder_fixtures
    {
        confirm_reminder(
            &runtime,
            json!({
                "title": title,
                "category": category,
                "linkedAccountId": account_key.map(|key| account_ids[key].clone()),
                "amount": amount,
                "dueOn": due_on,
                "advanceDays": advance_days,
                "recurrenceRule": recurrence_rule,
                "notes": "虚构冷启动事项"
            }),
        );
    }

    let planning_draft = save_planning_draft_at(
        &runtime,
        decode::<SavePlanningDraftRequest>(json!({
            "name": "家庭长期资产规划",
            "cashBuffer": "50000.00",
            "allocations": [
                {"category": "cash", "targetBps": 1500},
                {"category": "stable", "targetBps": 3000},
                {"category": "equity", "targetBps": 2500},
                {"category": "gold", "targetBps": 1000},
                {"category": "insurance", "targetBps": 1500},
                {"category": "other", "targetBps": 500}
            ],
            "notes": "模拟配置与真实账本分离"
        })),
    )
    .expect("planning draft should validate");
    confirm_planning_draft_at(
        &runtime,
        decode::<ConfirmPlanningDraftRequest>(json!({
            "draftId": field(planning_draft, "draftId"),
            "confirmedByUser": true
        })),
    )
    .expect("planning should confirm");

    runtime
        .with_unlocked_connection(|vault_id, connection| {
            let (accounts, _) = account_snapshot(connection, vault_id)?;
            let holdings = holding_snapshot(connection, vault_id)?;
            let transactions = transaction_snapshot(connection, vault_id)?;
            let reminders = reminder_snapshot(connection, vault_id)?;
            let planning = planning_snapshot(connection, vault_id)?;
            assert_eq!(accounts.len(), 9);
            assert_eq!(holdings.len(), 7);
            assert_eq!(transactions.len(), 26);
            assert_eq!(reminders.len(), 9);
            assert!(planning.is_some());

            let cny_net_minor: i64 = connection
                .query_row(
                    "SELECT COALESCE(SUM(balance.balance_minor), 0)
                     FROM account_balances balance
                     JOIN accounts account
                       ON account.id = balance.account_id
                      AND account.vault_id = balance.vault_id
                     WHERE balance.vault_id = ?1 AND account.currency = 'CNY'",
                    [vault_id],
                    |row| row.get(0),
                )
                .map_err(|_| "Unable to calculate the cold-start net balance.".to_owned())?;
            assert_eq!(cny_net_minor, 231_486_417);

            for (key, expected_minor) in [("invest", 38_640_000_i64), ("wealth", 18_000_000)] {
                let account_id = &account_ids[key];
                let balance_minor: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE vault_id = ?1 AND account_id = ?2",
                        [vault_id, account_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| "Unable to read a reconciled account balance.".to_owned())?;
                let holding_minor: i64 = connection
                    .query_row(
                        "SELECT COALESCE(SUM(valuation.market_value_minor), 0)
                         FROM holding_valuations valuation
                         JOIN holdings holding
                           ON holding.id = valuation.holding_id
                          AND holding.vault_id = valuation.vault_id
                         WHERE valuation.vault_id = ?1 AND holding.account_id = ?2",
                        [vault_id, account_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| "Unable to calculate holding reconciliation.".to_owned())?;
                assert_eq!(balance_minor, expected_minor);
                assert_eq!(holding_minor, expected_minor);
            }

            let confirmed_drafts: i64 = connection
                .query_row(
                    "SELECT count(*) FROM draft_changes
                     WHERE vault_id = ?1 AND status = 'confirmed'",
                    [vault_id],
                    |row| row.get(0),
                )
                .map_err(|_| "Unable to count confirmed cold-start drafts.".to_owned())?;
            assert_eq!(confirmed_drafts, 52);
            Ok(())
        })
        .expect("encrypted cold-start state should verify");
}
