import type { ItemSlot } from "@financio/shared";

/**
 * Трейдер за столом: сцена из SVG-слоёв одного размера (360×240), как бумажная кукла.
 * Каждый слот подставляет файл <slot>-<id>.svg, пустой — <slot>-none.svg (если есть).
 * SVG вставляются inline, чтобы CSS анимировал группы #head, #eyes, #arm-*, #screen.
 * Новый предмет = новый файл в assets/avatar, код менять не нужно.
 */
const LAYERS = import.meta.glob<string>("../assets/avatar/*.svg", { query: "?raw", import: "default", eager: true });

function layer(name: string): string | undefined {
  return LAYERS[`../assets/avatar/${name}.svg`];
}

/** Порядок слоёв снизу вверх */
const ORDER: (ItemSlot | "room" | "character" | "desk")[] = [
  "room",
  "chair",
  "character",
  "desk",
  "monitor",
  "keyboard",
  "talisman",
];

export function TraderScene({ equipped }: { equipped: Partial<Record<ItemSlot, string>> }) {
  const svgs = ORDER.map((part) => {
    if (part === "room" || part === "character" || part === "desk") return { key: part, svg: layer(part) };
    const id = equipped[part];
    return { key: `${part}-${id ?? "none"}`, svg: (id && layer(`${part}-${id}`)) || layer(`${part}-none`) };
  });
  return (
    <div className="trader-scene" aria-hidden="true">
      {svgs.map(({ key, svg }) =>
        svg ? <div key={key} className="scene-layer" dangerouslySetInnerHTML={{ __html: svg }} /> : null,
      )}
    </div>
  );
}
