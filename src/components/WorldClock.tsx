import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe } from "lucide-react";
import { TIMEZONES, formatPH, getTimezone } from "@/lib/date-utils";

const FEATURED = [
  "Asia/Manila",
  "Asia/Singapore",
  "Australia/Sydney",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

export function WorldClock() {
  const [now, setNow] = useState(new Date());
  const active = getTimezone();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const zones = Array.from(new Set([active, ...FEATURED]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" /> World Clock
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {zones.map((tz) => {
          const label = TIMEZONES.find((t) => t.value === tz)?.label || tz;
          const isActive = tz === active;
          return (
            <div
              key={tz}
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                isActive ? "bg-primary/10 border border-primary/30" : "bg-accent/30"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{label}</p>
                <p className="text-[11px] text-muted-foreground">{formatPH(now, "EEE, MMM d", tz)}</p>
              </div>
              <p className="font-display font-bold tabular-nums text-sm">
                {formatPH(now, "h:mm:ss a", tz)}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
