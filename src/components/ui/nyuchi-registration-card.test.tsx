import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  NyuchiRegistrationCard,
  type RegistrationTier,
} from "./nyuchi-registration-card";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: undefined,
  });
});

const tiers: RegistrationTier[] = [
  { id: "general", name: "General", price: 0 },
  { id: "vip", name: "VIP", price: 25 },
];

describe("NyuchiRegistrationCard", () => {
  it("renders tiers with radio semantics and formatted prices", () => {
    const { getByText, getByRole } = render(
      <NyuchiRegistrationCard tiers={tiers} />,
    );
    expect(
      document.querySelector('[data-slot="nyuchi-registration-card"]'),
    ).toBeTruthy();
    expect(getByRole("radiogroup", { name: "Ticket tiers" })).toBeTruthy();
    expect(getByText("General")).toBeTruthy();
    expect(getByText("VIP")).toBeTruthy();
    expect(getByText("Free")).toBeTruthy();
    // Locale-neutral: the viewer's own formatting of US$25.
    expect(
      getByText(
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: "USD",
        }).format(25),
      ),
    ).toBeTruthy();
  });

  it("increments quantity when the + control is clicked", () => {
    const { getByLabelText, getByText } = render(
      <NyuchiRegistrationCard tiers={tiers} min={1} max={5} />,
    );
    expect(getByText("1")).toBeTruthy();
    fireEvent.click(getByLabelText("Increase quantity"));
    expect(getByText("2")).toBeTruthy();
  });

  it("selects a tier and submits the chosen tier + quantity", () => {
    let payload: { tierId: string | null; quantity: number } | null = null;
    const { getByRole, getByText } = render(
      <NyuchiRegistrationCard tiers={tiers} onSubmit={(p) => (payload = p)} />,
    );
    fireEvent.click(getByRole("radio", { name: /VIP/ }));
    fireEvent.click(getByText(/Register/));
    expect(payload).toEqual({ tierId: "vip", quantity: 1 });
  });

  it("formats prices in the event's own currency", () => {
    const { getByRole } = render(
      <NyuchiRegistrationCard
        tiers={[{ id: "vip", name: "VIP", price: 25 }]}
        currency="EUR"
      />,
    );
    const expected = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "EUR",
    }).format(25);
    expect(getByRole("radio").textContent).toContain(expected);
  });
});
