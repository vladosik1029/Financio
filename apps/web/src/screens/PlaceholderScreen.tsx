import { useTranslation } from "react-i18next";

export function PlaceholderScreen({ section }: { section: "portfolio" | "career" | "rating" }) {
  const { t } = useTranslation();
  return (
    <div className="screen placeholder">
      <h2>{t("placeholder.title")}</h2>
      <p className="muted">{t(`placeholder.${section}`)}</p>
    </div>
  );
}
