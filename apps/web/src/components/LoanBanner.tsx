import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorKey } from "../lib/format";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";

/** Банкротство: наставник даёт в долг, чтобы игрок вернулся в игру */
export function LoanBanner() {
  const { t } = useTranslation();
  const { profile, refresh } = useApp();
  const [error, setError] = useState<string | null>(null);
  if (!profile.canTakeLoan) return null;

  const take = async () => {
    try {
      await api.loan();
      haptic.success();
      await refresh();
    } catch (err) {
      setError(t(errorKey(err)));
    }
  };

  return (
    <div className="loan">
      <div>
        <b>{t("loan.title")}</b>
        <div className="small">{t("loan.text", { amount: profile.loanAmount })}</div>
        {error && <div className="small down">{error}</div>}
      </div>
      <button className="btn btn-gold" onClick={take}>
        {t("loan.take")}
      </button>
    </div>
  );
}
