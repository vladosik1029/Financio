import { useState } from "react";
import { useTranslation } from "react-i18next";
import { haptic } from "../lib/telegram";
import { Sheet } from "./Sheet";

const PRESETS = [5, 10, 25, 50, 75, 100, 125, 150];

export function LeverageSheet({
  value,
  min,
  max,
  onApply,
  onClose,
}: {
  value: number;
  min: number;
  max: number;
  onApply(leverage: number): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [lev, setLev] = useState(value);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const presets = [...PRESETS.filter((p) => p >= min && p < max), max];

  return (
    <Sheet title={t("trade.leverage")} onClose={onClose}>
      <div className="lev-stepper">
        <button className="icon-btn big" onClick={() => setLev(clamp(lev - 1))}>
          −
        </button>
        <span className="mono lev-value">{lev}x</span>
        <button className="icon-btn big" onClick={() => setLev(clamp(lev + 1))}>
          +
        </button>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={1}
        value={lev}
        onChange={(e) => {
          haptic.tap();
          setLev(Number(e.target.value));
        }}
      />
      <div className="chips wrap">
        {presets.map((p) => (
          <button key={p} className={p === lev ? "chip active" : "chip"} onClick={() => setLev(p)}>
            {p}x
          </button>
        ))}
      </div>
      <p className="muted small">{t("trade.leverageMax", { max })}</p>
      {lev >= 50 && <p className="small down">{t("trade.highLeverage")}</p>}
      <button
        className="btn btn-brand"
        onClick={() => {
          haptic.impact();
          onApply(lev);
          onClose();
        }}
      >
        {t("trade.apply")}
      </button>
    </Sheet>
  );
}
