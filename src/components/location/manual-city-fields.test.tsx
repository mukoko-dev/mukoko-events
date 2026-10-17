import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ManualCityFields } from "./manual-city-fields";

afterEach(cleanup);

describe("ManualCityFields", () => {
  it("lets any city be typed and any country chosen", () => {
    const onChange = vi.fn();
    const { getByLabelText, rerender } = render(
      <ManualCityFields city="" country="" onChange={onChange} />,
    );

    const country = getByLabelText("Country") as HTMLSelectElement;
    expect(country.options.length).toBeGreaterThan(249);
    fireEvent.change(country, { target: { value: "JP" } });
    expect(onChange).toHaveBeenLastCalledWith({
      addressLocality: "",
      addressCountry: "Japan",
    });

    rerender(<ManualCityFields city="" country="Japan" onChange={onChange} />);
    fireEvent.change(getByLabelText("City"), { target: { value: "Tokyo" } });
    expect(onChange).toHaveBeenLastCalledWith({
      addressLocality: "Tokyo",
      addressCountry: "Japan",
    });
  });

  it("keeps a stored country it doesn't recognise rather than dropping it", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <ManualCityFields
        city="Somewhere"
        country="Atlantis"
        onChange={onChange}
      />,
    );
    const country = getByLabelText("Country") as HTMLSelectElement;
    expect(country.selectedOptions[0].textContent).toBe("Atlantis");
    fireEvent.change(getByLabelText("City"), {
      target: { value: "Elsewhere" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      addressLocality: "Elsewhere",
      addressCountry: "Atlantis",
    });
  });
});
