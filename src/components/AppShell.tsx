// One column on mobile, always. Gutters and gaps from the §8.2 scale.
import { Settings as SettingsIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { IconButton } from "./ui/button";
import { useRipple } from "../hooks/useRipple";

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface Props {
  items: NavItem[];
  current: string;
  onNavigate: (id: string) => void;
  onOpenSettings: () => void;
  children: React.ReactNode;
}

export function AppShell({ items, current, onNavigate, onOpenSettings, children }: Props) {
  const ripple = useRipple();
  const title = items.find((i) => i.id === current)?.label ?? "myAnalyst";

  return (
    <div className="min-h-dvh bg-surface text-on-surface flex flex-col">
      <header className="sticky top-0 z-30 bg-surface/85 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-8
                        h-16 flex items-center justify-between gap-4">
          <span className="headline-sm text-on-surface">{title}</span>
          {/* Settings: gear in the top bar on desktop, last nav item on mobile. */}
          {/* Settings lives in the top bar on desktop and in the nav on mobile.
              The wrapper does the hiding: two display utilities on one element
              is a specificity coin-toss, not a rule. */}
          <span className="hidden sm:block">
            <IconButton aria-label="Settings" onClick={onOpenSettings}>
              <SettingsIcon size={24} strokeWidth={1.75} />
            </IconButton>
          </span>
        </div>
      </header>

      <main
        id="main"
        className="flex-1 mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-8
                   pt-2 pb-28 sm:pb-14"
      >
        {children}
      </main>

      <nav
        aria-label="Sections"
        className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-surface-container
                   pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="flex">
          {items.map((item) => {
            const active = item.id === current;
            const Icon = item.icon;
            return (
              <li key={item.id} className="flex-1">
                <button
                  onPointerDown={ripple}
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={
                    "state-layer w-full min-h-14 flex flex-col items-center justify-center gap-1 " +
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary " +
                    (active ? "text-primary" : "text-on-surface-variant")
                  }
                >
                  <Icon size={20} strokeWidth={1.75} />
                  <span className="text-[0.6875rem] font-medium tracking-[0.03em]">
                    {item.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label="Sections" className="hidden sm:block border-0">
        <div className="mx-auto w-full max-w-[1120px] px-6 lg:px-8 pb-6">
          <ul className="flex gap-2">
            {items
              .filter((i) => i.id !== "settings")
              .map((item) => {
                const active = item.id === current;
                return (
                  <li key={item.id}>
                    <button
                      onPointerDown={ripple}
                      onClick={() => onNavigate(item.id)}
                      aria-current={active ? "page" : undefined}
                      className={
                        "state-layer rounded-full h-11 px-5 text-[0.875rem] font-medium " +
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
                        (active
                          ? "bg-secondary-container text-on-secondary-container"
                          : "text-on-surface-variant")
                      }
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      </nav>
    </div>
  );
}
