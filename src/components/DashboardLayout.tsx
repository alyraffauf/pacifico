import {
  IconAddressBook,
  IconAdjustments,
  IconBook,
  IconBraces,
  IconChevronDown,
  IconDeviceDesktop,
  IconFingerprint,
  IconInfoCircle,
  IconKey,
  IconLogout,
  IconMessageCircle,
  IconShield,
  IconTicket,
  IconUsers,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { logout, switchAccount } from "../lib/auth.ts";
import { api } from "../lib/api.ts";
import type { Did } from "../lib/types/branded.ts";
import type { Session } from "../lib/types/api.ts";
import { useAuthState } from "../hooks/useAuthState.ts";
import { getSiteHostname } from "../lib/site.ts";
import { useTranslation } from "../lib/i18n.ts";
import { SiteMark } from "./SiteMark.tsx";

type NavigationItem = {
  path: string;
  labelKey: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: "true" }>;
  visible?: (session: Session) => boolean;
  externalUrl?: (session: Session) => string;
};

function isHostedDidWeb(session: Session): boolean {
  if (!session.did.startsWith("did:web:")) return false;
  const didHostname = session.did.split(":")[2];
  const currentHostname = globalThis.location?.hostname;
  return Boolean(
    didHostname &&
    currentHostname &&
    (didHostname === currentHostname ||
      didHostname.endsWith(`.${currentHostname}`)),
  );
}

const navigationItems: NavigationItem[] = [
  {
    path: "settings",
    labelKey: "dashboard.navSettings",
    icon: IconAdjustments,
    visible: (session) => session.accountKind !== "migrated",
  },
  { path: "security", labelKey: "dashboard.navSecurity", icon: IconShield },
  {
    path: "sessions",
    labelKey: "dashboard.navSessions",
    icon: IconDeviceDesktop,
  },
  {
    path: "app-passwords",
    labelKey: "dashboard.navAppPasswords",
    icon: IconKey,
    visible: (session) => session.accountKind !== "migrated",
  },
  {
    path: "comms",
    labelKey: "dashboard.navComms",
    icon: IconMessageCircle,
    visible: (session) => session.accountKind !== "migrated",
  },
  {
    path: "repo",
    labelKey: "dashboard.navRepo",
    icon: IconBook,
    visible: (session) => session.accountKind !== "migrated",
    externalUrl: (session) => `https://pdsls.dev/at://${session.did}`,
  },
  {
    path: "controllers",
    labelKey: "dashboard.navDelegation",
    icon: IconUsers,
    visible: (session) => session.accountKind !== "migrated",
  },
  {
    path: "invite-codes",
    labelKey: "dashboard.navInviteCodes",
    icon: IconTicket,
    visible: (session) => session.isAdmin && session.accountKind !== "migrated",
  },
  {
    path: "did-document",
    labelKey: "dashboard.navDidDocument",
    icon: IconBraces,
    visible: (session) =>
      isHostedDidWeb(session) || session.accountKind === "migrated",
  },
  {
    path: "admin",
    labelKey: "dashboard.navAdmin",
    icon: IconFingerprint,
    visible: (session) => session.isAdmin,
  },
  { path: "about", labelKey: "dashboard.navAbout", icon: IconInfoCircle },
];

export function DashboardLayout({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const hostname = getSiteHostname();
  const t = useTranslation();
  const auth = useAuthState();
  const navigate = useNavigate();
  const location = useLocation();
  const accountMenuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [inviteCodesEnabled, setInviteCodesEnabled] = useState(false);
  const savedAccounts = auth.savedAccounts.filter(
    (account) => account.did !== session.did,
  );

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node))
        setAccountMenuOpen(false);
    }
    function closeMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void api
      .describeServer()
      .then((server) => {
        if (active) setInviteCodesEnabled(server.inviteCodeRequired);
      })
      .catch(() => {
        if (active) setInviteCodesEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!location.pathname) return;
    const activeItem = navRef.current?.querySelector<HTMLElement>(
      "[aria-current='page']",
    );
    activeItem?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [location.pathname]);

  async function signOut() {
    await logout();
    navigate("/app/login");
  }

  async function changeAccount(did: Did) {
    const result = await switchAccount(did);
    setAccountMenuOpen(false);
    if (result.ok) navigate("/app/settings");
  }

  return (
    <div className="min-h-screen bg-ctp-base lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b border-ctp-surface0 bg-ctp-crust lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex min-h-16 items-center border-b border-ctp-surface0 px-4">
          <a
            href="/"
            className="flex min-w-0 items-center gap-3 font-mono text-sm font-semibold text-ctp-text no-underline"
          >
            <SiteMark className="h-9 w-8" />
            <span className="truncate">{hostname}</span>
          </a>
        </div>

        <div
          className="relative border-b border-ctp-surface0 p-3"
          ref={menuRef}
        >
          <button
            type="button"
            aria-expanded={accountMenuOpen}
            aria-controls={accountMenuId}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-ctp-surface0 bg-ctp-mantle/40 px-3 py-3 text-left hover:border-ctp-surface1 hover:bg-ctp-mantle"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-sm font-semibold text-ctp-text">
                @{session.handle}
              </span>
              <span className="block truncate font-mono text-xs text-ctp-overlay1">
                {session.did}
              </span>
              {session.contactKind !== "none" ? (
                <span className="mt-2 flex items-center gap-1.5 text-xs text-ctp-overlay1">
                  <IconAddressBook className="size-3.5" aria-hidden="true" />
                  {(session.contactKind === "email" &&
                    session.emailConfirmed) ||
                  (session.contactKind === "channel" &&
                    session.preferredChannelVerified)
                    ? t("dashboard.verified")
                    : t("dashboard.unverified")}
                </span>
              ) : null}
            </span>
            <IconChevronDown
              className={`size-4 shrink-0 text-ctp-overlay1 transition-transform ${accountMenuOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          {accountMenuOpen ? (
            <div
              id={accountMenuId}
              className="absolute inset-x-3 top-full z-20 mt-1 rounded border border-ctp-surface1 bg-ctp-mantle p-1 shadow-xl"
            >
              {savedAccounts.map((account) => (
                <button
                  key={account.did}
                  type="button"
                  className="block w-full rounded px-3 py-2 text-left text-sm text-ctp-subtext1 hover:bg-ctp-surface0 hover:text-ctp-text"
                  onClick={() => void changeAccount(account.did)}
                >
                  @{account.handle}
                </button>
              ))}
              <button
                type="button"
                className="block w-full rounded px-3 py-2 text-left text-sm text-ctp-subtext1 hover:bg-ctp-surface0 hover:text-ctp-text"
                onClick={() => navigate("/app/login")}
              >
                {t("dashboard.addAnotherAccount")}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ctp-red hover:bg-ctp-surface0"
                onClick={() => void signOut()}
              >
                <IconLogout className="size-4" aria-hidden="true" />{" "}
                {t("dashboard.signOut", { handle: session.handle })}
              </button>
            </div>
          ) : null}
        </div>

        <nav
          ref={navRef}
          aria-label="Account navigation"
          className="dashboard-navigation flex gap-1 overflow-x-auto p-3 lg:grid lg:flex-1 lg:content-start lg:gap-1 lg:overflow-x-hidden lg:overflow-y-auto lg:py-4"
        >
          {navigationItems
            .filter((item) => {
              if (item.path === "invite-codes" && !inviteCodesEnabled)
                return false;
              return item.visible?.(session) ?? true;
            })
            .map(({ path, labelKey, icon: Icon, externalUrl }) => {
              const content = (
                <>
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap">{t(labelKey)}</span>
                </>
              );
              if (externalUrl) {
                return (
                  <a
                    key={path}
                    href={externalUrl(session)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-10 shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ctp-subtext0 no-underline transition-colors hover:bg-ctp-mantle hover:text-ctp-text"
                  >
                    {content}
                  </a>
                );
              }
              return (
                <NavLink
                  key={path}
                  to={`/app/${path}`}
                  className={({ isActive }) =>
                    `flex min-h-10 shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium no-underline transition-colors ${isActive ? "bg-ctp-surface0 text-ctp-lavender" : "text-ctp-subtext0 hover:bg-ctp-mantle hover:text-ctp-text"}`
                  }
                >
                  {content}
                </NavLink>
              );
            })}
        </nav>
      </aside>

      <main className="min-w-0 px-4 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
