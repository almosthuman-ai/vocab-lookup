import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "vocab-install-dismissed-v1";
const IOS_HINT_KEY = "vocab-ios-hint-shown-v1";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  );
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    const onInstalled = () => {
      localStorage.setItem(DISMISS_KEY, "installed");
      setInstallEvent(null);
    };
    window.addEventListener("appinstalled", onInstalled);

    // iOS hint
    if (isIos() && !localStorage.getItem(IOS_HINT_KEY)) {
      setShowIosHint(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setInstallEvent(null);
  };

  const dismissIos = () => {
    localStorage.setItem(IOS_HINT_KEY, "1");
    setShowIosHint(false);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    localStorage.setItem(DISMISS_KEY, "prompted");
    setInstallEvent(null);
  };

  if (installEvent) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-accent px-4 py-2.5 text-accent-foreground text-sm">
        <span>Install Vocab Lookup for faster access?</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="default" onClick={install} className="h-8">
            Install
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={dismiss}
            className="h-8 w-8"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-accent px-4 py-2.5 text-accent-foreground text-sm">
        <span>
          Tip: tap the Share icon and choose <b>Add to Home Screen</b> to install.
        </span>
        <Button
          size="icon"
          variant="ghost"
          onClick={dismissIos}
          className="h-8 w-8 -mt-0.5 shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return null;
}
