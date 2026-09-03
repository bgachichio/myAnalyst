import { useState } from "react";
import { BarChart3, BookOpen, LineChart, Settings as SettingsIcon, Star } from "lucide-react";
import { AppShell, type NavItem } from "./components/AppShell";
import { SettingsSheet } from "./components/SettingsSheet";
import { useAppearance } from "./hooks/useAppearance";
import { Analyse } from "./screens/Analyse";
import { Placeholder } from "./screens/Placeholder";

const ITEMS: NavItem[] = [
  { id: "analyse", label: "Analyse", icon: LineChart },
  { id: "watchlist", label: "Watchlist", icon: Star },
  { id: "compare", label: "Compare", icon: BarChart3 },
  { id: "journal", label: "Journal", icon: BookOpen },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [current, setCurrent] = useState("analyse");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, setTheme, fontScale, setFontScale } = useAppearance();

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
        {current === "analyse" && <Analyse />}
        {current === "watchlist" && (
          <Placeholder
            heading="Watchlist"
            what="Counters you are holding or waiting on, with the dividend book-closure date and the last day to buy for it."
            blockedBy="The collector has to run once against the live NSE page first."
          />
        )}
        {current === "compare" && (
          <Placeholder
            heading="Compare"
            what="Sector peers on the NSE, and cross-listed comparables, each showing the discount rate used on its side of the border."
            blockedBy="Waiting on the comparables milestone."
          />
        )}
        {current === "journal" && (
          <Placeholder
            heading="Journal"
            what="Every verdict with the parameters and the price that produced it, so six months on you can read what you predicted against what happened."
            blockedBy="It fills as you record analyses."
          />
        )}
      </AppShell>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        fontScale={fontScale}
        setFontScale={setFontScale}
      />
    </>
  );
}
