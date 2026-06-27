import { useEffect, useState } from "react";

export function Waveform({ active }: { active: boolean }) {
  const [bars, setBars] = useState<number[]>(Array(24).fill(0));

  useEffect(() => {
    if (!active) {
      setBars(Array(24).fill(4));
      return;
    }

    const interval = setInterval(() => {
      setBars((prev) =>
        prev.map(() => Math.floor(Math.random() * 24) + 4)
      );
    }, 100);

    return () => clearInterval(interval);
  }, [active]);

  return (
    <div className="flex items-end gap-[2px] h-8 overflow-hidden" data-testid="waveform">
      {bars.map((height, i) => (
        <div
          key={i}
          className={`w-1.5 transition-all duration-75 rounded-t-sm ${
            active ? "bg-primary" : "bg-muted"
          }`}
          style={{ height: `${height}px` }}
        />
      ))}
    </div>
  );
}
