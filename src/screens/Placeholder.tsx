// An honest empty state. It says what will fill the screen and what has to
// happen first, rather than showing invented rows.
import { Card } from "../components/ui/card";

export function Placeholder({
  heading,
  what,
  blockedBy,
}: {
  heading: string;
  what: string;
  blockedBy: string;
}) {
  return (
    <div className="flex flex-col gap-6 pt-4">
      <h2 className="headline-sm text-on-surface">{heading}</h2>
      <Card>
        <div className="flex flex-col gap-4">
          <p className="text-[0.9375rem] leading-7 text-on-surface max-w-[68ch]">{what}</p>
          <p className="text-[0.875rem] leading-6 text-on-surface-variant max-w-[68ch]">
            Nothing here yet. {blockedBy}
          </p>
        </div>
      </Card>
    </div>
  );
}
