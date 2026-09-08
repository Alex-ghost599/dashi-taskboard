import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProjectAutomationMenu } from "./ProjectAutomationMenu";

afterEach(cleanup);

it("does not advertise confirmed auto-claiming while a pause is unconfirmed", () => {
  render(<ProjectAutomationMenu
    automation={{ status: "ACTIVE", enabledByUser: false, pausePending: true }}
    models={[]} pending={false} error={null} unavailableReason={null}
    onOpen={() => {}} onChange={() => {}}
  />);
  const button = screen.getByRole("button", { name: /Pause unconfirmed|暂停待确认/ });
  expect(button.className).not.toContain("is-active");
  expect(button.textContent).toMatch(/Pause unconfirmed|暂停待确认/);
});
