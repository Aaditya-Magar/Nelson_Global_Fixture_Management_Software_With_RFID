import type { LocationJoin } from "@/lib/fixtures";
import { locationPathText } from "@/lib/fixtures";
import { MapPin } from "lucide-react";

export function FixtureLocationBadge({ current_slot, className = "" }: { current_slot: LocationJoin; className?: string }) {
  const text = locationPathText({ current_slot });
  if (!text) {
    return (
      <div className={`text-xs text-amber-600 flex items-center gap-1 ${className}`}>
        ⚠️ Location not assigned — contact admin
      </div>
    );
  }
  return (
    <div className={`text-xs text-muted-foreground flex items-center gap-1 ${className}`}>
      <MapPin className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  );
}
