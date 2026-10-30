import { getCoin, type Candle, type TimeframeId } from "@financio/shared";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { marketSocket } from "../lib/market";
import { useApp } from "../lib/store";
import { theme } from "../lib/theme";

/** Lightweight Charts рисует время в UTC, поэтому сдвигаем его в часовой пояс игрока */
const TZ_OFFSET_SEC = -new Date().getTimezoneOffset() * 60;

function toBar(c: Candle) {
  return { time: (c.time / 1000 + TZ_OFFSET_SEC) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}

export function PriceChart({ symbol, tf }: { symbol: string; tf: TimeframeId }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const positions = useApp((s) => s.open);

  useEffect(() => {
    const chart = createChart(containerRef.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.muted,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        attributionLogo: true,
      },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: theme.border },
      timeScale: { borderColor: theme.border, timeVisible: true, secondsVisible: true, rightOffset: 4 },
    });
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      borderVisible: false,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
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

  // Линии входа, ликвидации, TP и SL открытых позиций по этой монете
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of linesRef.current) series.removePriceLine(line);
    linesRef.current = [];
    for (const p of positions) {
      if (p.symbol !== symbol) continue;
      const add = (price: number | null, color: string, title: string, style = LineStyle.Dashed) => {
        if (price == null) return;
        linesRef.current.push(
          series.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true }),
        );
      };
      add(p.entryPrice, p.side === "long" ? theme.up : theme.down, `${p.side === "long" ? "L" : "S"} ${p.leverage}x`, LineStyle.Solid);
      add(p.liquidationPrice, theme.gold, "LIQ");
      add(p.takeProfit, theme.up, "TP");
      add(p.stopLoss, theme.down, "SL");
    }
  }, [positions, symbol]);

  return <div className="chart" ref={containerRef} />;
}
