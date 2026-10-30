import type { Leaderboard, LeaderboardPeriod, LeaderboardRow } from "@financio/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { formatSigned } from "../lib/format";
import { rankKey } from "../lib/game";

const PERIODS: LeaderboardPeriod[] = ["day", "week", "all"];

function Row({ row, me }: { row: LeaderboardRow; me?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={me ? "lb-row me" : "lb-row"}>
      <span className={`lb-rank mono${row.rank <= 3 ? ` top${row.rank}` : ""}`}>{row.rank}</span>
      <div className="lb-name">
        <div>{row.name}</div>
        <div className="muted small">
          {t(`ranks.${rankKey(row.level)}`)} · {t("leaderboard.trades", { n: row.trades })}
        </div>
      </div>
      <span className={`mono ${row.pnl >= 0 ? "up" : "down"}`}>{formatSigned(row.pnl)}</span>
    </div>
  );
}

/** Рейтинг по реализованному PnL за сутки, неделю или всё время */
export function LeaderboardView() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<LeaderboardPeriod>("day");
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    api
      .leaderboard(period)
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [period]);

  const meInTop = board?.me && board.rows.some((r) => r.userId === board.me!.userId);
  return (
    <>
      <div className="chips">
        {PERIODS.map((p) => (
          <button key={p} className={p === period ? "chip active" : "chip"} onClick={() => setPeriod(p)}>
            {t(`leaderboard.${p}`)}
          </button>
        ))}
      </div>
      {error && <p className="muted">{t("errors.network")}</p>}
      {board && board.period === period && (
        <section className="card lb">
          {board.rows.length === 0 ? (
            <p className="muted small">{t("leaderboard.empty")}</p>
          ) : (
            board.rows.map((r) => <Row key={r.userId} row={r} me={r.userId === board.me?.userId} />)
          )}
          {board.me && !meInTop && (
            <>
              <div className="lb-gap">···</div>
              <Row row={board.me} me />
            </>
          )}
        </section>
      )}
      <p className="muted small">{t("leaderboard.hint")}</p>
    </>
  );
}
