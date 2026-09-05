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
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
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
      <aside className="border-b border-ctp-surface-0 bg-ctp-crust lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex min-h-16 items-center justify-between border-b border-ctp-surface-0 px-4">
          <a
            href="/"
            className="flex items-center gap-3 font-mono text-sm font-semibold text-ctp-text no-underline"
          >
            <SiteMark className="h-10 w-9" />
            {hostname}
          </a>
        </div>

        <div
          className="relative border-b border-ctp-surface-0 p-3"
          ref={menuRef}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left hover:bg-ctp-surface-0"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-sm font-semibold text-ctp-text">
                @{session.handle}
              </span>
              <span className="block truncate font-mono text-xs text-ctp-overlay-1">
                {session.did}
              </span>
            </span>
            <IconChevronDown
              className="size-4 shrink-0 text-ctp-overlay-1"
              aria-hidden="true"
            />
          </button>
          {accountMenuOpen ? (
            <div className="absolute inset-x-3 top-full z-20 mt-1 rounded border border-ctp-surface-1 bg-ctp-mantle p-1 shadow-xl">
              {savedAccounts.map((account) => (
                <button
                  key={account.did}
                  type="button"
                  className="block w-full rounded px-3 py-2 text-left text-sm text-ctp-subtext-1 hover:bg-ctp-surface-0 hover:text-ctp-text"
                  onClick={() => void changeAccount(account.did)}
                >
                  @{account.handle}
                </button>
              ))}
              <button
                type="button"
                className="block w-full rounded px-3 py-2 text-left text-sm text-ctp-subtext-1 hover:bg-ctp-surface-0 hover:text-ctp-text"
                onClick={() => navigate("/app/login")}
              >
                {t("dashboard.addAnotherAccount")}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ctp-red hover:bg-ctp-surface-0"
                onClick={() => void signOut()}
              >
                <IconLogout className="size-4" aria-hidden="true" />{" "}
                {t("dashboard.signOut")}
              </button>
            </div>
          ) : null}
        </div>

        <nav
          ref={navRef}
          aria-label="Account navigation"
          className="flex gap-1 overflow-x-auto p-3 lg:block lg:overflow-visible"
        >
          {navigationItems
            .filter((item) => {
              if (item.path === "invite-codes" && !inviteCodesEnabled)
                return false;
              return item.visible?.(session) ?? true;
            })
            .map(({ path, labelKey, icon: Icon }) => (
              <NavLink
                key={path}
                to={`/app/${path}`}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-3 rounded px-3 py-2 text-sm font-medium no-underline transition-colors ${isActive ? "bg-ctp-surface-0 text-ctp-lavender" : "text-ctp-subtext-0 hover:bg-ctp-surface-0 hover:text-ctp-text"}`
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {t(labelKey)}
              </NavLink>
            ))}
        </nav>

        <div className="hidden px-4 pt-2 text-xs text-ctp-overlay-0 lg:block">
          {session.contactKind !== "none" ? (
            <p className="flex items-center gap-2">
              <IconAddressBook className="size-3" aria-hidden="true" />{" "}
              {(session.contactKind === "email" && session.emailConfirmed) ||
              (session.contactKind === "channel" &&
                session.preferredChannelVerified)
                ? t("dashboard.verified")
                : t("dashboard.unverified")}
            </p>
          ) : null}
        </div>
      </aside>

      <main className="min-w-0 px-4 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
