/**
 * The create-circle flow at /circles?create=1: the sign-in gate, the form's
 * field checks, errors from the API and the hand-off to the new circle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("server-only", () => ({}));

const { push, redirect, REDIRECT } = vi.hoisted(() => {
  const REDIRECT = new Error("NEXT_REDIRECT");
  return {
    REDIRECT,
    push: vi.fn(),
    redirect: vi.fn(() => {
      throw REDIRECT;
    }),
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  redirect,
}));
let user: unknown = null;
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn(async () => ({ user })),
}));
vi.mock("@/lib/auth/dev", () => ({ isDevBypass: () => false }));
vi.mock("@/lib/nyuchi-api/client", () => ({
  isNyuchiApiConfigured: () => true,
}));
vi.mock("@/lib/mongo/lookups", () => ({
  listCategories: vi.fn(async () => [
    { id: "arts", name: "Arts", group: "Culture" },
  ]),
}));
vi.mock("./circles-index-client", () => ({ default: () => <p>index</p> }));
vi.mock("@/components/ui/address-autocomplete", () => ({
  AddressAutocomplete: () => <input aria-label="Place search" />,
}));
const createCircleAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/create-circle", () => ({ createCircleAction }));

import CirclesIndexPage from "./page";
import { CreateCircleForm } from "./create-circle-form";

beforeEach(() => {
  vi.clearAllMocks();
  user = null;
});
afterEach(cleanup);

describe("/circles?create=1", () => {
  it("sends a signed-out visitor to sign in and back to the form", async () => {
    await expect(
      CirclesIndexPage({ searchParams: Promise.resolve({ create: "1" }) }),
    ).rejects.toBe(REDIRECT);
    expect(redirect).toHaveBeenCalledWith(
      "/auth/hosted?return_to=%2Fcircles%3Fcreate%3D1",
    );
  });

  it("opens the form for a signed-in person, with interest categories", async () => {
    user = { id: "u1" };
    render(
      await CirclesIndexPage({
        searchParams: Promise.resolve({ create: "1" }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Create a circle" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Arts")).toBeInTheDocument();
  });

  it("shows the index without ?create=1", async () => {
    render(await CirclesIndexPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("index")).toBeInTheDocument();
  });
});

describe("CreateCircleForm", () => {
  const renderForm = (available = true) =>
    render(<CreateCircleForm categories={[]} available={available} />);
  const nameInput = () => screen.getByLabelText("Name");
  const slugInput = () => screen.getByLabelText("Web address");
  const submit = () =>
    fireEvent.click(screen.getByRole("button", { name: "Create circle" }));

  it("says so when creating isn't available yet", () => {
    renderForm(false);
    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create circle" })).toBeNull();
  });

  it("explains each circle type", () => {
    renderForm();
    for (const label of ["Public", "Private", "Secret", "Broadcast"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(
      screen.getByText(/People join only by invitation/),
    ).toBeInTheDocument();
  });

  it("checks the fields before sending", async () => {
    renderForm();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check the highlighted fields.",
    );
    expect(screen.getByText("Give your circle a name.")).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(createCircleAction).not.toHaveBeenCalled();
  });

  it("fills the slug from the name until it is edited", () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: "Harare Makers" } });
    expect(slugInput()).toHaveValue("harare-makers");
    fireEvent.change(slugInput(), { target: { value: "makers" } });
    fireEvent.change(nameInput(), { target: { value: "Harare Makers Club" } });
    expect(slugInput()).toHaveValue("makers");
  });

  it("opens the new circle's page on success", async () => {
    createCircleAction.mockResolvedValueOnce({
      ok: true,
      circle: { id: "c-new", slug: "harare-makers", circleType: "public" },
    });
    renderForm();
    fireEvent.change(nameInput(), { target: { value: "Harare Makers" } });
    submit();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/circles/c-new?created=1"),
    );
    expect(createCircleAction.mock.calls[0][0]).toMatchObject({
      name: "Harare Makers",
      slug: "harare-makers",
      circleType: "public",
      postApproval: "off",
      inLanguage: "en",
    });
  });

  it("offers another slug when the address is taken", async () => {
    createCircleAction.mockResolvedValueOnce({
      ok: false,
      formError: null,
      fieldErrors: { slug: "That address is taken. Choose another." },
      suggestedSlug: "harare-makers-2",
    });
    renderForm();
    fireEvent.change(nameInput(), { target: { value: "Harare Makers" } });
    submit();
    expect(
      await screen.findByText("That address is taken. Choose another."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Use harare-makers-2" }),
    );
    expect(slugInput()).toHaveValue("harare-makers-2");
    expect(
      screen.queryByText("That address is taken. Choose another."),
    ).toBeNull();
  });
});
