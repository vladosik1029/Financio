import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { OrderCard } from "../components/OrderCard";
import { ClosedPositionRow, OpenPositionCard } from "../components/PositionCard";
import { useApp } from "../lib/store";

export function PortfolioScreen() {
  const { t } = useTranslation();
  const { open, history, orders, refreshHistory } = useApp();

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  return (
    <div className="screen portfolio">
      <h3>{t("positions.open")}</h3>
      {open.length === 0 ? <p className="muted">{t("positions.none")}</p> : open.map((p) => <OpenPositionCard key={p.id} position={p} />)}
      {orders.length > 0 && (
        <>
          <h3>{t("orders.title")}</h3>
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </>
      )}
      <h3>{t("positions.history")}</h3>
      {history.length === 0 ? (
        <p className="muted">{t("positions.noHistory")}</p>
      ) : (
        history.map((p) => <ClosedPositionRow key={p.id} position={p} />)
      )}
    </div>
  );
}
