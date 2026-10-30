import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Нижняя шторка поверх экрана, как выбор пары и плеча на Bybit */
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>{title}</b>
          <button className="icon-btn" onClick={onClose} aria-label="close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
