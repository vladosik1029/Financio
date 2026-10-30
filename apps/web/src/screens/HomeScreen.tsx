import { getCoin, unrealizedPnl } from "@financio/shared";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Logo";
import { LoanBanner } from "../components/LoanBanner";
import { EventBanner } from "../components/EventBanner";
import { MentorCard } from "../components/MentorCard";
import { accountSummary, rankKey, tradeStats, untilQuestReset } from "../lib/game";
import { formatSigned, formatUsd } from "../lib/format";
import { useMarket } from "../lib/market";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";

/** 12 500 → 12.5k: суммы квестов не влезают в строку целиком */
const compact = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v));

/** Кабинет трейдера: первый экран с балансом, уровнем и квестами дня */
export function HomeScreen() {
  const { t } = useTranslation();
  const { name, profile, open, history, refreshHistory, setTab, setSymbol } = useApp();
  const tickers = useMarket((s) => s.tickers);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const account = accountSummary(profile.balance, open, tickers);
  const stats = tradeStats(history);
  const xpPct = Math.min(100, (profile.xp / profile.xpToNext) * 100);

  const goTrade = (symbol?: string) => {
    haptic.tap();
    if (symbol) setSymbol(symbol);
    setTab("trade");
  };

  return (
    <div className="screen home">
      <div className="brand-head">
        <Logo size={26} />
        iZZi <span>Financio</span>
      </div>
      <section className="card trader">
        <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>
        <div className="trader-main">
          <div className="trader-name">{name}</div>
          <div className="muted small">
            {t(`ranks.${rankKey(profile.level)}`)} · {t("hud.level", { level: profile.level })}
          </div>
          <div className="xp-bar">
            <div className="xp-fill" style={{ width: `${xpPct}%` }} />
          </div>
          <div className="muted small mono">
            {profile.xp} / {profile.xpToNext} XP
          </div>
        </div>
      </section>

      <section className="card balance">
        <div className="muted small">{t("home.equity")}</div>
        <div className="balance-value mono">{formatUsd(account.equity)}</div>
        <div className={`small mono ${stats.todayPnl >= 0 ? "up" : "down"}`}>
          {t("home.today")} {formatSigned(stats.todayPnl)}
        </div>
        <div className="balance-grid">
          <div>
            <div className="muted small">{t("home.available")}</div>
            <div className="mono">{formatUsd(profile.balance)}</div>
          </div>
          <div>
            <div className="muted small">{t("home.inPositions")}</div>
            <div className="mono">{formatUsd(account.inPositions)}</div>
          </div>
          <div>
            <div className="muted small">{t("home.unrealized")}</div>
            <div className={`mono ${account.unrealized >= 0 ? "up" : "down"}`}>{formatSigned(account.unrealized)}</div>
          </div>
        </div>
        <button className="btn btn-brand" onClick={() => goTrade()}>
          {t("home.toTrade")}
        </button>
      </section>

      <LoanBanner />
      <EventBanner />
      <MentorCard />

      <div className="section-head">
        <h3>{t("home.quests")}</h3>
        <span className="muted small">{t("home.questsReset", { time: untilQuestReset() })}</span>
      </div>
      <section className="card quests">
        {profile.quests.map((q) => {
          const done = q.done;
          return (
            <div key={q.id} className={done ? "quest done" : "quest"}>
              <span className="quest-mark">{done && <Icon name="check" size={14} />}</span>
              <div className="quest-main">
                <div>{t(`quests.${q.id}`)}</div>
                <div className="quest-bar">
                  <div style={{ width: `${(q.progress / q.goal) * 100}%` }} />
                </div>
              </div>
              <span className="quest-reward">
                <span className="mono small">+{q.xp} XP</span>
                <span className="mono small muted">
                  {q.kind === "volume" || q.kind === "pnl"
                    ? `$${compact(q.progress)}/$${compact(q.goal)}`
                    : `${q.progress}/${q.goal}`}
                </span>
              </span>
            </div>
          );
        })}
      </section>

      <h3>{t("home.stats")}</h3>
      <section className="stat-row">
        <div className="card stat">
          <div className="muted small">{t("home.trades")}</div>
          <div className="mono">{stats.total}</div>
        </div>
        <div className="card stat">
          <div className="muted small">{t("home.winRate")}</div>
          <div className="mono">{stats.winRate == null ? "—" : `${Math.round(stats.winRate * 100)}%`}</div>
        </div>
        <div className="card stat">
          <div className="muted small">{t("home.best")}</div>
          <div className={`mono ${(stats.best ?? 0) > 0 ? "up" : ""}`}>{stats.best == null ? "—" : formatSigned(stats.best)}</div>
        </div>
      </section>

      {open.length > 0 && (
        <>
          <h3>{t("positions.open")}</h3>
          <section className="card list">
            {open.map((p) => {
              const coin = getCoin(p.symbol)!;
              const mark = tickers[p.symbol]?.mark ?? p.entryPrice;
              const pnl = unrealizedPnl(p.side, p.entryPrice, mark, p.quantity);
              return (
                <button key={p.id} className="list-row" onClick={() => goTrade(p.symbol)}>
                  <span className={p.side === "long" ? "tag tag-long" : "tag tag-short"}>
                    {t(`trade.${p.side}`)} {p.leverage}x
                  </span>
                  <span className="pos-coin">{coin.base}/USDT</span>
                  <span className={`mono ${pnl >= 0 ? "up" : "down"}`}>{formatSigned(pnl)}</span>
                </button>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
