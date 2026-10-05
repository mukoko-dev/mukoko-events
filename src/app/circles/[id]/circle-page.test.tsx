/**
 * /circles/[id] — the server-side gate and what each audience is shown.
 *
 * The async RSC is invoked directly with `getCircle` mocked (its access rules
 * are covered in src/app/actions/circle-detail.test.ts); the client leaf
 * renders under jsdom with a fake auth context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import type { CircleDetail, CircleViewer } from "@/app/actions/circle-detail";

vi.mock("server-only", () => ({}));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let auth = { user: null as null | { personId: string; name: string } };
vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => ({ ...auth, isAuthenticated: auth.user !== null }),
}));

const actions = vi.hoisted(() => ({
  getCircle: vi.fn(),
  getCircleEvents: vi.fn(async () => []),
  getCirclePosts: vi.fn(async () => []),
  getCircleMembers: vi.fn(async () => []),
  getCircleCalendars: vi.fn(async () => []),
  createCirclePost: vi.fn(),
  joinCircle: vi.fn(),
  togglePostReaction: vi.fn(),
  ensureCircleConversationAction: vi.fn(),
}));
vi.mock("@/app/actions/circle-detail", () => actions);
vi.mock("@/app/actions/calendars", () => ({
  getMyOwnedCalendarsAction: vi.fn(async () => []),
  updateCalendarAction: vi.fn(),
}));
vi.mock("./attach-calendar", () => ({ AttachCalendar: () => null }));
vi.mock("./circle-discuss", () => ({ CircleDiscuss: () => null }));

import CircleDetailPage from "./page";

const ID = "8d3f2a52-6a43-4a43-9c0e-6f1f9d1f2b10";

const NONE: CircleViewer = {
  access: "reader",
  isSignedIn: false,
  isMember: false,
  isOwner: false,
  isStaff: false,
  canReadPosts: false,
  canSeeEvents: false,
  canSeeMembers: false,
  canPost: false,
  canReact: false,
  canUseChat: false,
  canSeeArchive: false,
  join: null,
};

function circle(viewer: Partial<CircleViewer>): CircleDetail {
  return {
    id: ID,
    name: "Harare Makers",
    description: "People who make things.",
    circle_purpose: "",
    member_count: 12,
    post_count: 4,
    linked_event_id: null,
    owner_person_id: null,
    viewer: { ...NONE, ...viewer },
  };
}

async function renderPage(id = ID) {
  const ui = await CircleDetailPage({ params: Promise.resolve({ id }) });
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth = { user: null };
});
afterEach(cleanup);

describe("CircleDetailPage gate", () => {
  it("404s when the circle is hidden from the viewer (secret, inactive or missing)", async () => {
    actions.getCircle.mockResolvedValue(null);
    await expect(
      CircleDetailPage({ params: Promise.resolve({ id: ID }) }),
    ).rejects.toBe(NOT_FOUND);
    expect(actions.getCircle).toHaveBeenCalledWith(ID);
  });

  it("404s a malformed id without a lookup", async () => {
    await expect(
      CircleDetailPage({ params: Promise.resolve({ id: "not-a-uuid" }) }),
    ).rejects.toBe(NOT_FOUND);
    expect(actions.getCircle).not.toHaveBeenCalled();
  });

  it("shows a private circle's preview to a non-member, with no content requests", async () => {
    auth = { user: { personId: "p-outsider", name: "Out Sider" } };
    actions.getCircle.mockResolvedValue(
      circle({ access: "preview", isSignedIn: true, join: "request" }),
    );
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "Harare Makers" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This circle is private/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request to join" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    await waitFor(() => {
      expect(actions.getCirclePosts).not.toHaveBeenCalled();
      expect(actions.getCircleMembers).not.toHaveBeenCalled();
      expect(actions.getCircleEvents).not.toHaveBeenCalled();
    });
  });

  it("an anonymous reader of a public circle gets events and the stream, not the roster", async () => {
    actions.getCircle.mockResolvedValue(
      circle({
        access: "reader",
        canReadPosts: true,
        canSeeEvents: true,
        join: "join",
      }),
    );
    await renderPage();
    await waitFor(() =>
      expect(actions.getCirclePosts).toHaveBeenCalledWith(ID, 30, false),
    );
    expect(actions.getCircleMembers).not.toHaveBeenCalled();
    expect(screen.queryByRole("tab", { name: /members/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /archive/i })).toBeNull();
    // Signed out: no join button.
    expect(screen.queryByRole("button", { name: /join/i })).toBeNull();
  });

  it("a member gets the roster; circle staff also get the archive", async () => {
    auth = { user: { personId: "p-staff", name: "Mo Derator" } };
    actions.getCircle.mockResolvedValue(
      circle({
        access: "staff",
        isSignedIn: true,
        isMember: true,
        isStaff: true,
        canReadPosts: true,
        canSeeEvents: true,
        canSeeMembers: true,
        canPost: true,
        canReact: true,
        canUseChat: true,
        canSeeArchive: true,
      }),
    );
    await renderPage();
    await waitFor(() =>
      expect(actions.getCircleMembers).toHaveBeenCalledWith(ID, 100),
    );
    expect(screen.getAllByRole("tab").length).toBe(5);
  });

  it("after joining, re-resolves access on the server and loads member content", async () => {
    auth = { user: { personId: "p-new", name: "New Comer" } };
    const reader = circle({
      access: "reader",
      isSignedIn: true,
      canReadPosts: true,
      canSeeEvents: true,
      join: "join",
    });
    const joined = circle({
      access: "member",
      isSignedIn: true,
      isMember: true,
      canReadPosts: true,
      canSeeEvents: true,
      canSeeMembers: true,
      canPost: true,
      canReact: true,
      canUseChat: true,
    });
    actions.getCircle
      .mockResolvedValueOnce(reader)
      .mockResolvedValueOnce(joined);
    actions.joinCircle.mockResolvedValue("active");
    await renderPage();
    expect(actions.getCircleMembers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /join/i }));
    await waitFor(() =>
      expect(actions.getCircleMembers).toHaveBeenCalledWith(ID, 100),
    );
    expect(actions.getCircle).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /join/i })).toBeNull();
  });
});
