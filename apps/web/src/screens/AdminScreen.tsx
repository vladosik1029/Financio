import { getCoin, type GameSettings } from "@financio/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { adminApi, type AdminStats, type AdminUser, type LedgerEntry } from "../lib/api";
import { errorKey, formatSigned, formatUsd } from "../lib/format";
import { haptic } from "../lib/telegram";
import type { Position } from "@financio/shared";

type SettingType = "bool" | "num" | "int";
const SETTINGS: [keyof GameSettings, SettingType][] = [
  ["tradingEnabled", "bool"],
  ["takerFeeRate", "num"],
  ["startingBalance", "num"],
  ["maxOpenPositions", "int"],
  ["loanAmount", "num"],
  ["loanThreshold", "num"],
  ["loanCooldownHours", "num"],
];

const dt = (v: string | number | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

/** Кнопка с подтверждением вторым нажатием: в WebView Telegram системные диалоги ненадёжны */
function ConfirmButton({ label, confirm, onConfirm, className }: { label: string; confirm: string; onConfirm(): void; className: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      className={armed ? `${className} armed` : className}
      onClick={() => {
        haptic.tap();
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : label}
    </button>
  );
}

/** Админка внутри MiniApp: вкладка видна только игрокам из ADMIN_TELEGRAM_IDS */
export function AdminScreen() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);

  const flash = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast(null), 3000);
  };
  const fail = (err: unknown) => {
    haptic.error();
    flash(t(errorKey(err)), true);
  };

  const loadStats = useCallback(() => adminApi.stats().then(setStats), []);
  const loadUsers = useCallback((q: string) => adminApi.users(q).then((r) => setUsers(r.users)), []);

  useEffect(() => {
    Promise.all([loadStats(), loadUsers(""), adminApi.settings().then((r) => setSettings(r.settings))]).catch(fail);
    const id = setInterval(() => void loadStats().catch(() => {}), 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStats, loadUsers]);

  if (selected != null) {
    return (
      <UserDetail
        id={selected}
        onBack={() => {
          setSelected(null);
          void loadUsers(query).catch(fail);
          void loadStats().catch(() => {});
        }}
        flash={flash}
        fail={fail}
      />
    );
  }

  const saveSettings = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!settings) return;
    try {
      const res = await adminApi.saveSettings(settings);
      setSettings(res.settings);
      haptic.success();
      flash(t("admin.saved"));
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="screen admin">
      <h3>{t("admin.summary")}</h3>
      <section className="admin-stats">
        {stats ? (
          <>
            <div className="card stat"><div className="muted small">{t("admin.users")}</div><div className="mono">{stats.users}</div></div>
            <div className="card stat"><div className="muted small">{t("admin.activeToday")}</div><div className="mono">{stats.activeToday}</div></div>
            <div className="card stat"><div className="muted small">{t("admin.openPositions")}</div><div className="mono">{stats.openPositions}</div></div>
            <div className="card stat"><div className="muted small">{t("admin.totalBalance")}</div><div className="mono">{formatUsd(stats.totalBalance)}</div></div>
            <div className="card stat"><div className="muted small">{t("admin.openMargin")}</div><div className="mono">{formatUsd(stats.openMargin)}</div></div>
            <div className="card stat">
              <div className="muted small">{t("admin.feed")}</div>
              <div className={stats.stale ? "down" : "up"}>{stats.feed} · {t(stats.stale ? "admin.stale" : "admin.live")}</div>
            </div>
          </>
        ) : (
          <p className="muted">…</p>
        )}
      </section>

      <h3>{t("admin.settings")}</h3>
      {settings && (
        <form className="card admin-form" onSubmit={saveSettings}>
          {SETTINGS.map(([key, type]) => (
            <label key={key} className="admin-field">
              <span>{t(`admin.setting.${key}`)}</span>
              {type === "bool" ? (
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings[key] as boolean}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                />
              ) : (
                <input
                  className="mono input"
                  type="number"
                  step={type === "int" ? 1 : "any"}
                  value={settings[key] as number}
                  onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
                />
              )}
            </label>
          ))}
          <button className="btn btn-brand">{t("admin.save")}</button>
        </form>
      )}

      <h3>{t("admin.players")}</h3>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          void loadUsers(query.trim()).catch(fail);
        }}
      >
        <input className="input wide" placeholder={t("admin.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="chip">{t("admin.find")}</button>
      </form>
      <section className="card list">
        {users.length === 0 && <p className="muted">{t("admin.noUsers")}</p>}
        {users.map((u) => (
          <button key={u.id} className="list-row" onClick={() => setSelected(u.id)}>
            <span className="user-cell">
              <span>
                {u.firstName} {u.banned && <span className="tag tag-short">{t("admin.banned")}</span>}
              </span>
              <span className="muted small">
                {u.username ? `@${u.username} · ` : ""}ID {u.id} · {t("hud.level", { level: u.level })}
              </span>
            </span>
            <span className="mono">{formatUsd(u.balance)}</span>
          </button>
        ))}
      </section>
      {toast && <div className={toast.error ? "toast error floating" : "toast floating"}>{toast.text}</div>}
    </div>
  );
}

function UserDetail({
  id,
  onBack,
  flash,
  fail,
}: {
  id: number;
  onBack(): void;
  flash(text: string): void;
  fail(err: unknown): void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ user: AdminUser; open: Position[]; history: Position[]; ledger: LedgerEntry[] } | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => adminApi.user(id).then(setData).catch(fail), [id, fail]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      haptic.success();
      flash(done);
      await load();
    } catch (err) {
      fail(err);
    }
  };

  const u = data?.user;
  return (
    <div className="screen admin">
      <button className="link back" onClick={onBack}>
        ‹ {t("admin.back")}
      </button>
      {!u ? (
        <p className="muted">…</p>
      ) : (
        <>
          <section className="card">
            <div className="trader-name">
              {u.firstName} {u.username && <span className="muted">@{u.username}</span>}
            </div>
            <div className="muted small">
              ID {u.id} · {t("hud.level", { level: u.level })} · XP {u.xp} · {t("admin.since", { date: dt(u.createdAt) })}
            </div>
            <div className="balance-value mono">{formatUsd(u.balance)}</div>
            <div className="muted small">{t("admin.lastSeen", { date: dt(u.lastSeenAt) })}</div>
            <ConfirmButton
              className={u.banned ? "chip" : "chip chip-danger"}
              label={t(u.banned ? "admin.unban" : "admin.ban")}
              confirm={t("admin.sure")}
              onConfirm={() => act(() => adminApi.ban(u.id, !u.banned), t(u.banned ? "admin.unbanned" : "admin.bannedDone"))}
            />
          </section>

          <h3>{t("admin.adjust")}</h3>
          <form
            className="card admin-form"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(amount.replace(",", "."));
              if (!n || !note.trim()) return;
              void act(() => adminApi.adjustBalance(u.id, n, note.trim()), t("admin.adjusted")).then(() => {
                setAmount("");
                setNote("");
              });
            }}
          >
            <input className="mono input wide" inputMode="decimal" placeholder={t("admin.amount")} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="input wide" placeholder={t("admin.note")} value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn-brand">{t("admin.apply")}</button>
          </form>

          <h3>{t("positions.open")}</h3>
          <section className="card list">
            {data.open.length === 0 && <p className="muted">{t("positions.none")}</p>}
            {data.open.map((p) => (
              <div key={p.id} className="list-row">
                <PositionLabel p={p} />
                <ConfirmButton
                  className="chip chip-danger"
                  label={t("positions.close")}
                  confirm={t("admin.sure")}
                  onConfirm={() => act(() => adminApi.closePosition(p.id), t("admin.closed"))}
                />
              </div>
            ))}
          </section>

          <h3>{t("positions.history")}</h3>
          <section className="card list">
            {data.history.length === 0 && <p className="muted">{t("positions.noHistory")}</p>}
            {data.history.map((p) => (
              <div key={p.id} className="list-row">
                <PositionLabel p={p} />
                <span className={`mono ${(p.realizedPnl ?? 0) >= 0 ? "up" : "down"}`}>{formatSigned(p.realizedPnl ?? 0)}</span>
              </div>
            ))}
          </section>

          <h3>{t("admin.ledger")}</h3>
          <section className="card list">
            {data.ledger.map((l) => (
              <div key={l.id} className="list-row">
                <span className="user-cell">
                  <span>{t(`admin.ledgerType.${l.type}`, { defaultValue: l.type })}</span>
                  <span className="muted small">
                    {dt(l.createdAt)}
                    {l.note ? ` · ${l.note}` : ""}
                  </span>
                </span>
                <span className="user-cell right">
                  <span className={`mono ${l.amount >= 0 ? "up" : "down"}`}>{formatSigned(l.amount)}</span>
                  <span className="mono muted small">{formatUsd(l.balanceAfter)}</span>
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function PositionLabel({ p }: { p: Position }) {
  const { t } = useTranslation();
  return (
    <span className="user-cell">
      <span>
        <span className={p.side === "long" ? "tag tag-long" : "tag tag-short"}>
          {t(`trade.${p.side}`)} {p.leverage}x
        </span>{" "}
        {getCoin(p.symbol)?.base ?? p.symbol} · {formatUsd(p.invested)}
      </span>
      <span className="muted small">#{p.id} · {dt(p.openedAt)}</span>
    </span>
  );
}
