import { useState } from "react";
import { BarChart3, Handshake, LineChart, Settings as SettingsIcon, Star } from "lucide-react";
import { AppShell, type NavItem } from "./components/AppShell";
import { SettingsSheet } from "./components/SettingsSheet";
import { useAppearance } from "./hooks/useAppearance";
import { useModel } from "./hooks/useModel";
import { Analyse } from "./screens/Analyse";
import { Compare } from "./screens/Compare";
import { Private } from "./screens/Private";
import { Watchlist } from "./screens/Watchlist";

const ITEMS: NavItem[] = [
  { id: "analyse", label: "Analyse", icon: LineChart },
  { id: "private", label: "Private", icon: Handshake },
  { id: "watchlist", label: "Watchlist", icon: Star },
  { id: "compare", label: "Compare", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [current, setCurrent] = useState("analyse");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, setTheme, fontScale, setFontScale } = useAppearance();
  const { model, set: setModel, reset: resetModel } = useModel();

  const openSettings = () => setSettingsOpen(true);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-4 focus:rounded-full
                   focus:bg-primary focus:px-5 focus:py-3 focus:text-on-primary"
      >
        Skip to content
      </a>

      <AppShell
        items={ITEMS}
        current={current}
        onNavigate={(id) => (id === "settings" ? openSettings() : setCurrent(id))}
        onOpenSettings={openSettings}
      >
        {current === "analyse" && <Analyse model={model} />}
        {current === "private" && <Private />}
        {current === "watchlist" && <Watchlist />}
        {current === "compare" && <Compare />}
      </AppShell>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        fontScale={fontScale}
        setFontScale={setFontScale}
        model={model}
        setModel={setModel}
        resetModel={resetModel}
      />
    </>
  );
}
