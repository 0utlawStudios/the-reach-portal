import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandKitPage } from "../pages/brand-kit-page";

vi.mock("@/lib/toast-context", () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    currentUser: {
      name: "Test User",
      email: "test@example.com",
      initials: "TU",
      role: "admin",
    },
  }),
}));

vi.mock("@/lib/pipeline-context", () => ({
  usePipeline: () => ({
    workspaceId: null,
  }),
}));

describe("BrandKitPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("renders The Reach client-intel tab from the distilled source brief", () => {
    render(<BrandKitPage />);

    fireEvent.click(screen.getByRole("button", { name: /Client Intel/i }));

    expect(screen.getByText("Business Position")).toBeInTheDocument();
    expect(screen.getByText(/AI cannot VIP a client or unlock advisor perks/i)).toBeInTheDocument();
    expect(screen.getByText("Target volume")).toBeInTheDocument();
    expect(screen.getByText(/15-25 leads or bookings per month/i)).toBeInTheDocument();
    expect(screen.getByText(/Where do you want to go, and how do you want to feel/i)).toBeInTheDocument();
  });

  it("renders the visual brand system without embedding the source PDF", () => {
    const { container } = render(<BrandKitPage />);

    fireEvent.click(screen.getByRole("button", { name: /Identity/i }));

    expect(screen.getByText("Sand")).toBeInTheDocument();
    expect(screen.getByText("#E1DFD5")).toBeInTheDocument();
    expect(screen.getByText(/Bradford by Lineto/i)).toBeInTheDocument();
    expect(screen.getByText(/Everett by Weltkern/i)).toBeInTheDocument();
    expect(screen.getByText("Photography System")).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("embed")).toBeNull();
  });
});
