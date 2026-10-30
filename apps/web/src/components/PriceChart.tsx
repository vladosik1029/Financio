import { getCoin, type Candle, type TimeframeId } from "@financio/shared";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { marketSocket } from "../lib/market";

/** Lightweight Charts рисует время в UTC, поэтому сдвигаем его в часовой пояс игрока */
const TZ_OFFSET_SEC = -new Date().getTimezoneOffset() * 60;

function toBar(c: Candle) {
  return { time: (c.time / 1000 + TZ_OFFSET_SEC) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}

export function PriceChart({ symbol, tf }: { symbol: string; tf: TimeframeId }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const chart = createChart(containerRef.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0e14" },
        textColor: "#8b93a7",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        attributionLogo: true,
      },
      grid: { vertLines: { color: "#161b26" }, horzLines: { color: "#161b26" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2633" },
      timeScale: { borderColor: "#1f2633", timeVisible: true, secondsVisible: true, rightOffset: 4 },
    });
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#16c784",
      downColor: "#ea3943",
      borderVisible: false,
      wickUpColor: "#16c784",
      wickDownColor: "#ea3943",
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const precision = getCoin(symbol)?.pricePrecision ?? 2;
    series.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
    series.setData([]);

    let cancelled = false;
    let lastTime = 0;
    const queued: Candle[] = [];
    const apply = (c: Candle) => {
      if (c.time < lastTime) return;
      lastTime = c.time;
      series.update(toBar(c));
    };

    // Обновления, пришедшие раньше истории, применяем после неё
    const unsubscribe = marketSocket.subscribeCandles(symbol, tf, (c) => {
      if (lastTime === 0) queued.push(c);
      else apply(c);
    });

    api
      .candles(symbol, tf)
      .then(({ candles }) => {
        if (cancelled) return;
        series.setData(candles.map(toBar));
        lastTime = candles[candles.length - 1]?.time ?? 1;
        queued.forEach(apply);
        chartRef.current?.timeScale().scrollToRealTime();
      })
      .catch(() => {
        lastTime = 1;
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [symbol, tf]);

  return <div className="chart" ref={containerRef} />;
}
