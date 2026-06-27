import { useEffect, useRef } from "react";

export const TURNSTILE_SITE_KEY = "1x00000000000000000000AA";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: Record<string, unknown>
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

type Props = {
  onSuccess: (token: string) => void;
  onExpire?: () => void;
  resetKey?: string | number;
};

export function TurnstileWidget({ onSuccess, onExpire, resetKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const renderWidget = () => {
      if (!containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        size: "normal",
        callback: (token: string) => {
          if (mounted) onSuccess(token);
        },
        "expired-callback": () => {
          if (mounted && onExpire) onExpire();
        },
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const script = document.querySelector(
        'script[src*="challenges.cloudflare.com/turnstile"]'
      );
      if (script) {
        script.addEventListener("load", renderWidget);
        return () => {
          mounted = false;
          script.removeEventListener("load", renderWidget);
        };
      }
    }

    return () => {
      mounted = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [resetKey]);

  return <div ref={containerRef} />;
}
