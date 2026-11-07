import { expect, it, vi } from "vitest";
import { createChangeHub } from "./live-changes";

it("refreshes a page only when the stamp moves, never for the first stamp", () => {
  const hub = createChangeHub();
  const refresh = vi.fn();
  hub.subscribe({ refresh, enabled: true });
  hub.publish("a");
  hub.publish("a");
  expect(refresh).not.toHaveBeenCalled();
  hub.publish("b");
  expect(refresh).toHaveBeenCalledTimes(1);
  hub.publish("b");
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("keeps a change for a paused page (a selection) and gives it once it resumes", () => {
  const hub = createChangeHub();
  hub.publish("a");
  const refresh = vi.fn();
  const sub = hub.subscribe({ refresh, enabled: false });
  hub.publish("b");
  expect(refresh).not.toHaveBeenCalled();
  hub.setEnabled(sub, true);
  expect(refresh).toHaveBeenCalledTimes(1);
  hub.setEnabled(sub, true);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("stops calling a page that left", () => {
  const hub = createChangeHub();
  hub.publish("a");
  const refresh = vi.fn();
  const sub = hub.subscribe({ refresh, enabled: true });
  hub.unsubscribe(sub);
  hub.publish("b");
  expect(refresh).not.toHaveBeenCalled();
});
