import { TIMEFRAMES } from "@financio/shared";
import { useApp } from "../lib/store";
import { haptic } from "../lib/telegram";

export function TimeframeTabs() {
  const { tf, setTf } = useApp();
  return (
    <div className="tf-tabs">
      {TIMEFRAMES.map((item) => (
        <button
          key={item.id}
          className={item.id === tf ? "tf active" : "tf"}
          onClick={() => {
            haptic.tap();
            setTf(item.id);
          }}
        >
          {item.id}
        </button>
      ))}
    </div>
  );
}
